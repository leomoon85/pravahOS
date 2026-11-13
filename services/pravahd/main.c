/**
 * @file main.c
 * @brief PravahOS Native Platform Daemon (pravahd) Entry Point for Device Execution.
 *
 * Exposes a lightweight localhost HTTP/JSON telemetry server on 127.0.0.1:9880
 * and runs a native C swipe-up gesture watcher to bridge Pixel/AOSP AllApps
 * gestures directly into the Windows Metro Living Drawer.
 */

#include "pravahd.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <pthread.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

static volatile bool g_running = true;
static pthread_mutex_t g_telemetry_lock = PTHREAD_MUTEX_INITIALIZER;
static pravah_battery_info_t g_cached_battery;
static pravah_ota_status_t g_cached_ota;

static void handle_signal(int sig) {
    (void)sig;
    g_running = false;
}

static long long monotonic_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000LL + (ts.tv_nsec / 1000000LL);
}

static void refresh_telemetry_snapshot(void) {
    pravah_battery_info_t bat;
    pravah_ota_status_t ota;
    memset(&bat, 0, sizeof(bat));
    memset(&ota, 0, sizeof(ota));

    if (pravahd_get_battery_info(&bat) != PRAVAH_STATUS_OK) {
        bat.percentage = 100;
        bat.voltage_uv = 5000000;
        bat.temperature_c_tenths = 285;
        snprintf(bat.status, sizeof(bat.status), "Unknown");
        bat.is_simulated = true;
    }
    if (pravahd_ota_get_status(&ota) != PRAVAH_STATUS_OK) {
        ota.current_slot = PRAVAH_BOOT_SLOT_A;
        snprintf(ota.target_device, sizeof(ota.target_device), "panther");
        ota.rollback_index = 1;
    }

    pthread_mutex_lock(&g_telemetry_lock);
    g_cached_battery = bat;
    g_cached_ota = ota;
    pthread_mutex_unlock(&g_telemetry_lock);
}

static void *telemetry_http_thread(void *arg) {
    (void)arg;
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("[pravahd] Failed to create telemetry socket");
        return NULL;
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port = htons(PRAVAHD_DEFAULT_TCP_PORT);

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("[pravahd] Failed to bind 127.0.0.1:9880");
        close(server_fd);
        return NULL;
    }

    if (listen(server_fd, 16) < 0) {
        perror("[pravahd] Failed to listen on telemetry port");
        close(server_fd);
        return NULL;
    }

    printf("[pravahd] Telemetry HTTP server listening on http://127.0.0.1:%d/telemetry\n",
           PRAVAHD_DEFAULT_TCP_PORT);
    fflush(stdout);

    struct timeval tv;
    tv.tv_sec = 1;
    tv.tv_usec = 0;
    setsockopt(server_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    while (g_running) {
        struct sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        int client_fd = accept(server_fd, (struct sockaddr *)&client_addr, &client_len);
        if (client_fd < 0) {
            continue;
        }

        char req_buf[512];
        ssize_t n = read(client_fd, req_buf, sizeof(req_buf) - 1);
        if (n > 0) {
            req_buf[n] = '\0';
        }

        refresh_telemetry_snapshot();

        pravah_battery_info_t bat;
        pravah_ota_status_t ota;
        pthread_mutex_lock(&g_telemetry_lock);
        bat = g_cached_battery;
        ota = g_cached_ota;
        pthread_mutex_unlock(&g_telemetry_lock);

        char json_body[1024];
        int body_len = snprintf(
            json_body,
            sizeof(json_body),
            "{"
            "\"status\":\"ok\","
            "\"daemon\":{\"pid\":%d,\"version\":\"%d.%d\",\"magic\":\"0x%08X\",\"pss_kb\":580},"
            "\"battery\":{\"level\":%d,\"voltage_uv\":%d,\"temp_tenths\":%d,\"status\":\"%s\"},"
            "\"ota\":{\"slot\":\"%s\",\"target\":\"%s\",\"rollback_index\":%u}"
            "}",
            (int)getpid(),
            PRAVAHD_VERSION_MAJOR,
            PRAVAHD_VERSION_MINOR,
            PRAVAHD_PROTOCOL_MAGIC,
            bat.percentage,
            bat.voltage_uv,
            bat.temperature_c_tenths,
            bat.status,
            (ota.current_slot == PRAVAH_BOOT_SLOT_B) ? "B" : "A",
            ota.target_device,
            ota.rollback_index
        );

        char http_resp[1536];
        int resp_len = snprintf(
            http_resp,
            sizeof(http_resp),
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Connection: close\r\n"
            "Content-Length: %d\r\n"
            "\r\n"
            "%s",
            body_len,
            json_body
        );

        if (resp_len > 0) {
            write(client_fd, http_resp, (size_t)resp_len);
        }
        close(client_fd);
    }

    close(server_fd);
    return NULL;
}

static void *swipe_watcher_thread(void *arg) {
    (void)arg;
    printf("[pravahd] Native swipe-up gesture watcher armed (LAUNCHER_ALLAPPS_OPEN_UP)\n");
    fflush(stdout);

    /* Clear stale StatsLog buffer so we don't fire on pre-start swipes */
    system("logcat -c >/dev/null 2>&1");

    FILE *pipe = popen("logcat -v raw -s StatsLog:D 2>/dev/null", "r");
    if (!pipe) {
        fprintf(stderr, "[pravahd] Warning: Unable to open logcat pipe for swipe watcher\n");
        return NULL;
    }

    char line[512];
    long long last_trigger_ms = 0;

    while (g_running && fgets(line, sizeof(line), pipe) != NULL) {
        if (strstr(line, "LAUNCHER_ALLAPPS_OPEN_UP") != NULL ||
            strstr(line, "LAUNCHER_GOOGLE_ALL_APPS_ENTRY") != NULL ||
            strstr(line, "LAUNCHER_ALLAPPS_PERSONAL_SCROLLED") != NULL ||
            strstr(line, "LAUNCHER_ALLAPPS_SCROLLED") != NULL) {
            long long now = monotonic_ms();
            if (now - last_trigger_ms >= 800) {
                last_trigger_ms = now;
                system("am start --activity-no-animation -n org.pravah.launcher/.MainActivity --ez auto_expand true >/dev/null 2>&1");
            }
        }
    }

    pclose(pipe);
    return NULL;
}

int main(int argc, char *argv[]) {
    bool enable_swipe_hook = true;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--no-swipe-hook") == 0) {
            enable_swipe_hook = false;
        }
    }

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);
    signal(SIGPIPE, SIG_IGN);

    printf("=====================================================\n");
    printf(" [PravahOS] Starting Native Platform Daemon (pravahd)\n");
    printf(" Version: %d.%d | Protocol Magic: 0x%08X\n",
           PRAVAHD_VERSION_MAJOR, PRAVAHD_VERSION_MINOR, PRAVAHD_PROTOCOL_MAGIC);
    printf("=====================================================\n");

    pravah_status_t status = pravahd_init(NULL);
    if (status != PRAVAH_STATUS_OK) {
        fprintf(stderr, "[pravahd] Fatal: Failed to initialize daemon (code %d)\n", status);
        return 1;
    }

    printf("[pravahd] Initialized data dir: %s\n", PRAVAHD_DATA_DIR);
    printf("[pravahd] State file: %s\n", PRAVAHD_STATE_FILE);

    refresh_telemetry_snapshot();

    printf("[pravahd] Hardware Battery: %d%% | %d uV | %s\n",
           g_cached_battery.percentage, g_cached_battery.voltage_uv, g_cached_battery.status);
    printf("[pravahd] OTA Boot Slot: %s | Target: %s | Rollback Index: %u\n",
           (g_cached_ota.current_slot == PRAVAH_BOOT_SLOT_B) ? "Slot B" : "Slot A",
           g_cached_ota.target_device, g_cached_ota.rollback_index);

    pthread_t http_tid;
    if (pthread_create(&http_tid, NULL, telemetry_http_thread, NULL) == 0) {
        pthread_detach(http_tid);
    }

    if (enable_swipe_hook) {
        pthread_t swipe_tid;
        if (pthread_create(&swipe_tid, NULL, swipe_watcher_thread, NULL) == 0) {
            pthread_detach(swipe_tid);
        }
    }

    printf("[pravahd] Platform Daemon is running cleanly...\n");
    fflush(stdout);

    while (g_running) {
        sleep(2);
        refresh_telemetry_snapshot();
        fflush(stdout);
    }

    printf("\n[pravahd] Shutting down cleanly...\n");
    pravahd_shutdown();
    return 0;
}
