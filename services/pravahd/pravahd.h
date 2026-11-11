/**
 * @file pravahd.h
 * @brief PravahOS Native Platform Daemon (pravahd) Interface.
 *
 * Defines the core hardware abstraction, IPC protocol, deterministic policy gate,
 * and crash-resilient state persistence for the AOSP/Linux physical device foundation.
 *
 * Target hardware: Google Pixel 7 (panther), Google Pixel 6 (oriole).
 */

#ifndef PRAVAH_SERVICES_PRAVAHD_H_
#define PRAVAH_SERVICES_PRAVAHD_H_

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Version & Protocol Magic */
#define PRAVAHD_VERSION_MAJOR       1
#define PRAVAHD_VERSION_MINOR       0
#define PRAVAHD_PROTOCOL_MAGIC      0x50525644 /* 'PRVD' */

/* Default IPC Endpoints */
#define PRAVAHD_DEFAULT_UNIX_SOCKET "/dev/socket/pravahd"
#define PRAVAHD_FALLBACK_SOCKET     "/tmp/pravahd.sock"
#define PRAVAHD_DEFAULT_TCP_PORT    9880

/* Default Storage Paths */
#define PRAVAHD_DATA_DIR            "/data/pravah"
#define PRAVAHD_STATE_FILE          "/data/pravah/system_state.json"
#define PRAVAHD_STATE_FILE_TMP      "/data/pravah/system_state.json.tmp"
#define PRAVAHD_FALLBACK_DATA_DIR   "/tmp/pravah"

/* Sysfs Hardware Node Paths for Pixel / Linux Phone Hardware */
#define SYSFS_BATTERY_CAPACITY      "/sys/class/power_supply/battery/capacity"
#define SYSFS_BATTERY_STATUS        "/sys/class/power_supply/battery/status"
#define SYSFS_BATTERY_VOLTAGE       "/sys/class/power_supply/battery/voltage_now"
#define SYSFS_BATTERY_TEMP          "/sys/class/power_supply/battery/temp"
#define SYSFS_BACKLIGHT_BRIGHTNESS  "/sys/class/backlight/panel0-backlight/brightness"
#define SYSFS_BACKLIGHT_MAX         "/sys/class/backlight/panel0-backlight/max_brightness"

/* Status / Return Codes */
typedef enum {
    PRAVAH_STATUS_OK                    = 0,
    PRAVAH_STATUS_ERR_INVALID_PARAM     = -1,
    PRAVAH_STATUS_ERR_PERMISSION_DENIED = -2,
    PRAVAH_STATUS_ERR_HARDWARE_UNAVAIL  = -3,
    PRAVAH_STATUS_ERR_IO                = -4,
    PRAVAH_STATUS_ERR_STATE_CORRUPTED   = -5,
    PRAVAH_STATUS_ERR_AUTH_REQUIRED     = -6,
    PRAVAH_STATUS_ERR_NOT_FOUND         = -7,
} pravah_status_t;

/* Policy Gate Risk Arbitration Levels */
typedef enum {
    PRAVAH_RISK_READ_ONLY      = 0, /* Informational, auto-granted */
    PRAVAH_RISK_REVERSIBLE     = 1, /* Non-destructive, checked against granted capabilities */
    PRAVAH_RISK_CONSEQUENTIAL  = 2, /* External/state mutation, requires explicit user intent */
    PRAVAH_RISK_IRREVERSIBLE   = 3, /* Factory reset, flashing, irreversible hardware wipe */
} pravah_risk_level_t;

/* Hardware Battery Telemetry Snapshot */
typedef struct {
    int percentage;             /* 0 .. 100 % */
    int voltage_uv;             /* microvolts (e.g. 4120000) */
    int temperature_c_tenths;   /* tenths of degree Celsius (e.g. 325 = 32.5 C) */
    char status[32];            /* "Charging", "Discharging", "Full", etc. */
    bool is_simulated;          /* True if read from mock/fallback during host unit testing */
} pravah_battery_info_t;

/* Display Brightness State */
typedef struct {
    int current_brightness;     /* 0 .. max_brightness */
    int max_brightness;         /* typically 255 or 4095 */
    bool is_simulated;
} pravah_display_info_t;

/* Daemon Configuration */
typedef struct {
    char data_dir[256];
    char state_file[256];
    char socket_path[256];
    int port;
    bool simulation_fallback_allowed;
    bool debug_logging;
} pravahd_config_t;

/* State Key-Value Pair */
typedef struct {
    char key[64];
    char value[256];
    uint64_t modified_timestamp_ms;
} pravah_state_entry_t;

/* Daemon Lifecycle Functions */
pravah_status_t pravahd_init(pravahd_config_t *config);
void pravahd_shutdown(void);

/* Hardware Operations */
pravah_status_t pravahd_get_battery_info(pravah_battery_info_t *out_info);
pravah_status_t pravahd_get_display_info(pravah_display_info_t *out_info);
pravah_status_t pravahd_set_display_brightness(int brightness_level, const char *auth_token);

/* Policy Enforcement */
pravah_status_t pravahd_verify_capability(const char *capability_name, pravah_risk_level_t required_level, const char *auth_token);

/* Persistent State Operations (Crash-Resilient Atomic Write Pattern) */
pravah_status_t pravahd_set_persistent_state(const char *key, const char *value, const char *auth_token);
pravah_status_t pravahd_get_persistent_state(const char *key, char *out_value, size_t max_len);
pravah_status_t pravahd_verify_state_integrity(void);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_SERVICES_PRAVAHD_H_ */
