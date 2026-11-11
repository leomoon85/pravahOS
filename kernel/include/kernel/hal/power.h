/**
 * @file power.h
 * @brief PravahOS Mobile Power Management & Battery/Thermal Governor HAL.
 *
 * Implements battery fuel-gauge telemetry (capacity %, voltage mV, charge rate mA, health),
 * multi-zone thermal governor (CPU, GPU, Battery, Skin) with multi-tier trip points,
 * and dynamic power state management (ACTIVE, IDLE, SUSPEND) with kernel wake-locks.
 */

#ifndef PRAVAH_KERNEL_HAL_POWER_H
#define PRAVAH_KERNEL_HAL_POWER_H

#include "kernel/types.h"
#include "kernel/memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Battery Fuel Gauge Constants & Status Enums                              */
/* ========================================================================= */

typedef enum {
    BATTERY_HEALTH_GOOD         = 0,
    BATTERY_HEALTH_OVERHEAT     = 1,
    BATTERY_HEALTH_DEAD         = 2,
    BATTERY_HEALTH_OVER_VOLTAGE = 3,
    BATTERY_HEALTH_COLD         = 4,
    BATTERY_HEALTH_UNKNOWN      = 5
} battery_health_t;

typedef enum {
    CHARGING_STATUS_DISCHARGING     = 0,
    CHARGING_STATUS_CHARGING_USB    = 1, /**< Standard 5V/1.5A (7.5W) */
    CHARGING_STATUS_CHARGING_FAST_PD= 2, /**< USB Power Delivery (18W - 65W) */
    CHARGING_STATUS_CHARGING_WIRELESS=3, /**< Qi Wireless Charging */
    CHARGING_STATUS_FULL            = 4, /**< 100% Top-off complete */
    CHARGING_STATUS_NOT_CHARGING    = 5  /**< Plugged in, charging suspended */
} charging_status_t;

typedef struct {
    uint8_t           percentage;          /**< 0 - 100% State of Charge */
    uint32_t          voltage_mv;          /**< Battery cell terminal voltage in mV (e.g. 3850 mV) */
    int32_t           current_ma;          /**< Instantaneous current in mA (positive = in, negative = out) */
    uint32_t          remaining_mah;       /**< Remaining charge in mAh */
    uint32_t          design_capacity_mah; /**< Nominal capacity e.g. 5000 mAh */
    int32_t           temperature_mdeg_c;  /**< Temperature in millidegrees C (e.g. 32000 = 32.0 C) */
    battery_health_t  health;
    charging_status_t charging_status;
    bool              is_present;
} battery_telemetry_t;

/* ========================================================================= */
/* Thermal Zones & Governor Enums                                           */
/* ========================================================================= */

#define THERMAL_MAX_ZONES            (4)

typedef enum {
    THERMAL_ZONE_CPU_CLUSTER0        = 0, /**< Cortex-A76 / High-Perf Big Cores */
    THERMAL_ZONE_GPU                 = 1, /**< Adreno / Mali 3D Rasterizer Engine */
    THERMAL_ZONE_BATTERY             = 2, /**< Li-Ion Pack Thermistor */
    THERMAL_ZONE_SKIN_SURFACE        = 3  /**< Chassis external touch temperature */
} thermal_zone_id_t;

typedef enum {
    THERMAL_TRIP_NORMAL              = 0, /**< Under 60 C - Maximum clock rates */
    THERMAL_TRIP_PASSIVE             = 1, /**< 60 - 75 C - Slight clock frequency scaling */
    THERMAL_TRIP_WARNING             = 2, /**< 75 - 85 C - Aggressive throttling, drop FPS to 60 */
    THERMAL_TRIP_CRITICAL            = 3, /**< 85 - 100 C - Offline auxiliary cores, drop brightness */
    THERMAL_TRIP_EMERGENCY_SHUTDOWN  = 4  /**< > 100 C - Immediate thermal safe halt */
} thermal_trip_level_t;

typedef struct {
    thermal_zone_id_t    zone_id;
    char                 zone_name[24];
    int32_t              current_temp_mdeg_c; /**< e.g. 42500 = 42.5 C */
    thermal_trip_level_t trip_level;
    int32_t              passive_trip_mdeg_c;
    int32_t              warning_trip_mdeg_c;
    int32_t              critical_trip_mdeg_c;
    int32_t              emergency_trip_mdeg_c;
} thermal_zone_info_t;

/* ========================================================================= */
/* Dynamic Power States & Wake Lock Subsystem                                */
/* ========================================================================= */

typedef enum {
    POWER_STATE_ACTIVE  = 0, /**< Cores fully operational, display enabled */
    POWER_STATE_IDLE    = 1, /**< Cores in WFI clock-gating, rapid wake */
    POWER_STATE_SUSPEND = 2  /**< Deep sleep, DRAM self-refresh, wake on IRQ */
} power_state_t;

#define MAX_WAKE_LOCKS               (16)
#define WAKE_LOCK_NAME_MAX           (32)

typedef struct {
    uint32_t id;
    char     name[WAKE_LOCK_NAME_MAX];
    bool     active;
    uint64_t acquired_timestamp_ns;
} wake_lock_entry_t;

/* ========================================================================= */
/* Power HAL Public API                                                      */
/* ========================================================================= */

/**
 * @brief Initialize the Mobile Power HAL, thermal zones, and battery gauge.
 */
zx_status_t power_hal_init(void);

/**
 * @brief Read real-time battery fuel gauge telemetry.
 */
zx_status_t power_get_battery_info(battery_telemetry_t *out_telemetry);

/**
 * @brief Query telemetry and trip points for a designated thermal zone.
 */
zx_status_t power_get_thermal_zone(thermal_zone_id_t zone_id, thermal_zone_info_t *out_info);

/**
 * @brief Set the dynamic power state of the system (ACTIVE, IDLE, SUSPEND).
 *
 * @note Transition to POWER_STATE_SUSPEND is denied with ZX_ERR_UNAVAILABLE
 *       if any wake lock is held by the system or applications.
 */
zx_status_t power_set_power_state(power_state_t state);

/**
 * @brief Query current dynamic power state.
 */
power_state_t power_get_power_state(void);

/**
 * @brief Acquire a wake-lock to prevent system deep sleep (suspend).
 *
 * @param name Diagnostic identifier of the requester.
 * @param out_lock_id Pointer to receive unique assigned lock ID.
 */
zx_status_t power_wake_lock_acquire(const char *name, uint32_t *out_lock_id);

/**
 * @brief Release a previously acquired wake-lock.
 *
 * @param lock_id Lock handle returned by power_wake_lock_acquire.
 */
zx_status_t power_wake_lock_release(uint32_t lock_id);

/**
 * @brief Query the total count of currently active wake-locks.
 */
uint32_t power_get_active_wake_locks(void);

/**
 * @brief Inject or simulate battery charging profile (for development/testing).
 */
zx_status_t power_simulate_charge_update(uint8_t percentage,
                                         charging_status_t charging_status,
                                         int32_t current_ma,
                                         uint32_t voltage_mv);

/**
 * @brief Inject or simulate thermal temperature update.
 */
zx_status_t power_simulate_thermal_update(thermal_zone_id_t zone_id, int32_t temp_mdeg_c);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_HAL_POWER_H */
