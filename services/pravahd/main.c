/**
 * @file main.c
 * @brief PravahOS Platform Daemon Entry Point for Device Execution.
 */

#include "pravahd.h"
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <signal.h>

static volatile bool g_running = true;

static void handle_signal(int sig) {
    (void)sig;
    g_running = false;
}

int main(int argc, char *argv[]) {
    (void)argc;
    (void)argv;

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);

    printf("=====================================================\n");
    printf(" [PravahOS] Starting Native Platform Daemon (pravahd)\n");
    printf(" Version: %d.%d | Protocol Magic: 0x%08X\n",
           PRAVAHD_VERSION_MAJOR, PRAVAHD_VERSION_MINOR, PRAVAHD_PROTOCOL_MAGIC);
    printf("=====================================================\n");

    pravahd_config_t config;
    pravah_status_t status = pravahd_init(&config);
    if (status != PRAVAH_STATUS_OK) {
        fprintf(stderr, "[pravahd] Fatal: Failed to initialize daemon (code %d)\n", status);
        return 1;
    }

    printf("[pravahd] Initialized data dir: %s\n", config.data_dir);
    printf("[pravahd] State file: %s\n", config.state_file);

    // Initial hardware telemetry probe
    pravah_battery_info_t battery;
    if (pravahd_get_battery_info(&battery) == PRAVAH_STATUS_OK) {
        printf("[pravahd] Hardware Battery: %d%% | %d uV | %s\n",
               battery.percentage, battery.voltage_uv, battery.status);
    } else {
        printf("[pravahd] Hardware Battery: (Not detected or simulated)\n");
    }

    // OTA Bootloader Status probe
    pravah_ota_status_t ota_status;
    if (pravahd_ota_get_status(&ota_status) == PRAVAH_STATUS_OK) {
        printf("[pravahd] OTA Boot Slot: %s | Target: %s | Rollback Index: %u\n",
               (ota_status.current_slot == PRAVAH_BOOT_SLOT_B) ? "Slot B" : "Slot A",
               ota_status.target_device, ota_status.rollback_index);
    }

    printf("[pravahd] Platform Daemon is running in background loop...\n");
    fflush(stdout);

    // Polling and heartbeat loop
    while (g_running) {
        sleep(2);
        pravahd_get_battery_info(&battery);
        fflush(stdout);
    }

    printf("\n[pravahd] Shutting down cleanly...\n");
    pravahd_shutdown();
    return 0;
}
