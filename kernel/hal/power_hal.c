/**
 * @file power_hal.c
 * @brief PravahOS Mobile Power Management & Battery/Thermal Governor HAL Implementation.
 *
 * Implements battery fuel-gauge telemetry, multi-zone thermal trip monitoring,
 * dynamic system power state transitions, and kernel wake-lock arbitration.
 */

#include "kernel/hal/power.h"
#include "kernel/memory.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

/* Subsystem State */
static battery_telemetry_t s_battery;
static thermal_zone_info_t s_thermal_zones[THERMAL_MAX_ZONES];
static power_state_t       s_current_power_state = POWER_STATE_ACTIVE;
static wake_lock_entry_t   s_wake_locks[MAX_WAKE_LOCKS];
static uint32_t            s_next_lock_id = 1;
static bool                s_power_initialized = false;

/* ========================================================================= */
/* Thermal Trip Point Evaluation                                             */
/* ========================================================================= */

static thermal_trip_level_t evaluate_thermal_level(int32_t temp, const thermal_zone_info_t *zone) {
    if (temp >= zone->emergency_trip_mdeg_c) {
        return THERMAL_TRIP_EMERGENCY_SHUTDOWN;
    } else if (temp >= zone->critical_trip_mdeg_c) {
        return THERMAL_TRIP_CRITICAL;
    } else if (temp >= zone->warning_trip_mdeg_c) {
        return THERMAL_TRIP_WARNING;
    } else if (temp >= zone->passive_trip_mdeg_c) {
        return THERMAL_TRIP_PASSIVE;
    }
    return THERMAL_TRIP_NORMAL;
}

/* ========================================================================= */
/* HAL Initialization                                                        */
/* ========================================================================= */

zx_status_t power_hal_init(void) {
    if (s_power_initialized) {
        return ZX_OK;
    }

    /* 1. Default Mobile Battery Profile (Li-Po 5000 mAh nominal) */
    s_battery.percentage = 85;
    s_battery.voltage_mv = 3980;
    s_battery.current_ma = -420; /* Discharging under mobile idle/display workload */
    s_battery.remaining_mah = 4250;
    s_battery.design_capacity_mah = 5000;
    s_battery.temperature_mdeg_c = 31500; /* 31.5 C */
    s_battery.health = BATTERY_HEALTH_GOOD;
    s_battery.charging_status = CHARGING_STATUS_DISCHARGING;
    s_battery.is_present = true;

    /* 2. Default Multi-Zone Thermal Monitors */
    /* Zone 0: CPU Cluster */
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].zone_id = THERMAL_ZONE_CPU_CLUSTER0;
    strncpy(s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].zone_name, "cpu-cluster0", 23);
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].current_temp_mdeg_c = 41200; /* 41.2 C */
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].passive_trip_mdeg_c = 65000;
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].warning_trip_mdeg_c = 80000;
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].critical_trip_mdeg_c = 95000;
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].emergency_trip_mdeg_c = 105000;
    s_thermal_zones[THERMAL_ZONE_CPU_CLUSTER0].trip_level = THERMAL_TRIP_NORMAL;

    /* Zone 1: GPU Rasterizer */
    s_thermal_zones[THERMAL_ZONE_GPU].zone_id = THERMAL_ZONE_GPU;
    strncpy(s_thermal_zones[THERMAL_ZONE_GPU].zone_name, "gpu-engine", 23);
    s_thermal_zones[THERMAL_ZONE_GPU].current_temp_mdeg_c = 38500; /* 38.5 C */
    s_thermal_zones[THERMAL_ZONE_GPU].passive_trip_mdeg_c = 65000;
    s_thermal_zones[THERMAL_ZONE_GPU].warning_trip_mdeg_c = 80000;
    s_thermal_zones[THERMAL_ZONE_GPU].critical_trip_mdeg_c = 92000;
    s_thermal_zones[THERMAL_ZONE_GPU].emergency_trip_mdeg_c = 102000;
    s_thermal_zones[THERMAL_ZONE_GPU].trip_level = THERMAL_TRIP_NORMAL;

    /* Zone 2: Battery Pack Thermistor */
    s_thermal_zones[THERMAL_ZONE_BATTERY].zone_id = THERMAL_ZONE_BATTERY;
    strncpy(s_thermal_zones[THERMAL_ZONE_BATTERY].zone_name, "battery-pack", 23);
    s_thermal_zones[THERMAL_ZONE_BATTERY].current_temp_mdeg_c = 31500; /* 31.5 C */
    s_thermal_zones[THERMAL_ZONE_BATTERY].passive_trip_mdeg_c = 45000;
    s_thermal_zones[THERMAL_ZONE_BATTERY].warning_trip_mdeg_c = 50000;
    s_thermal_zones[THERMAL_ZONE_BATTERY].critical_trip_mdeg_c = 55000;
    s_thermal_zones[THERMAL_ZONE_BATTERY].emergency_trip_mdeg_c = 60000;
    s_thermal_zones[THERMAL_ZONE_BATTERY].trip_level = THERMAL_TRIP_NORMAL;

    /* Zone 3: Skin / Touch Surface */
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].zone_id = THERMAL_ZONE_SKIN_SURFACE;
    strncpy(s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].zone_name, "skin-touch", 23);
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].current_temp_mdeg_c = 29000; /* 29.0 C */
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].passive_trip_mdeg_c = 40000;
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].warning_trip_mdeg_c = 43000;
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].critical_trip_mdeg_c = 48000;
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].emergency_trip_mdeg_c = 52000;
    s_thermal_zones[THERMAL_ZONE_SKIN_SURFACE].trip_level = THERMAL_TRIP_NORMAL;

    /* 3. Wake Lock Table Initialization */
    memset(s_wake_locks, 0, sizeof(s_wake_locks));
    s_next_lock_id = 1;
    s_current_power_state = POWER_STATE_ACTIVE;

    s_power_initialized = true;
    return ZX_OK;
}

/* ========================================================================= */
/* Battery Telemetry API                                                     */
/* ========================================================================= */

zx_status_t power_get_battery_info(battery_telemetry_t *out_telemetry) {
    if (!out_telemetry) return ZX_ERR_INVALID_ARGS;
    if (!s_power_initialized) return ZX_ERR_UNAVAILABLE;
    memcpy(out_telemetry, &s_battery, sizeof(battery_telemetry_t));
    return ZX_OK;
}

zx_status_t power_simulate_charge_update(uint8_t percentage,
                                         charging_status_t charging_status,
                                         int32_t current_ma,
                                         uint32_t voltage_mv) {
    if (percentage > 100) return ZX_ERR_INVALID_ARGS;
    s_battery.percentage = percentage;
    s_battery.charging_status = charging_status;
    s_battery.current_ma = current_ma;
    s_battery.voltage_mv = voltage_mv;
    s_battery.remaining_mah = ((uint32_t)percentage * s_battery.design_capacity_mah) / 100;

    if (percentage == 100 && current_ma >= 0) {
        s_battery.charging_status = CHARGING_STATUS_FULL;
    }
    return ZX_OK;
}

/* ========================================================================= */
/* Thermal Governor API                                                      */
/* ========================================================================= */

zx_status_t power_get_thermal_zone(thermal_zone_id_t zone_id, thermal_zone_info_t *out_info) {
    if (zone_id >= THERMAL_MAX_ZONES || !out_info) return ZX_ERR_INVALID_ARGS;
    if (!s_power_initialized) return ZX_ERR_UNAVAILABLE;
    memcpy(out_info, &s_thermal_zones[zone_id], sizeof(thermal_zone_info_t));
    return ZX_OK;
}

zx_status_t power_simulate_thermal_update(thermal_zone_id_t zone_id, int32_t temp_mdeg_c) {
    if (zone_id >= THERMAL_MAX_ZONES) return ZX_ERR_INVALID_ARGS;
    s_thermal_zones[zone_id].current_temp_mdeg_c = temp_mdeg_c;
    s_thermal_zones[zone_id].trip_level = evaluate_thermal_level(temp_mdeg_c, &s_thermal_zones[zone_id]);
    return ZX_OK;
}

/* ========================================================================= */
/* Dynamic Power State & Wake Lock Arbitration                               */
/* ========================================================================= */

zx_status_t power_set_power_state(power_state_t state) {
    if (state > POWER_STATE_SUSPEND) return ZX_ERR_INVALID_ARGS;
    if (!s_power_initialized) return ZX_ERR_UNAVAILABLE;

    /* Deep sleep transition veto check */
    if (state == POWER_STATE_SUSPEND) {
        if (power_get_active_wake_locks() > 0) {
            /* Denied: Active wake-lock held by system or user task */
            return ZX_ERR_UNAVAILABLE;
        }
    }

    s_current_power_state = state;
    return ZX_OK;
}

power_state_t power_get_power_state(void) {
    return s_current_power_state;
}

zx_status_t power_wake_lock_acquire(const char *name, uint32_t *out_lock_id) {
    if (!out_lock_id) return ZX_ERR_INVALID_ARGS;
    if (!s_power_initialized) return ZX_ERR_UNAVAILABLE;

    for (uint32_t i = 0; i < MAX_WAKE_LOCKS; i++) {
        if (!s_wake_locks[i].active) {
            s_wake_locks[i].id = s_next_lock_id++;
            s_wake_locks[i].active = true;
            s_wake_locks[i].acquired_timestamp_ns = 0;
            if (name) {
                strncpy(s_wake_locks[i].name, name, WAKE_LOCK_NAME_MAX - 1);
                s_wake_locks[i].name[WAKE_LOCK_NAME_MAX - 1] = '\0';
            } else {
                strncpy(s_wake_locks[i].name, "unnamed_lock", WAKE_LOCK_NAME_MAX - 1);
            }
            *out_lock_id = s_wake_locks[i].id;
            return ZX_OK;
        }
    }

    return ZX_ERR_NO_RESOURCES;
}

zx_status_t power_wake_lock_release(uint32_t lock_id) {
    if (lock_id == 0) return ZX_ERR_INVALID_ARGS;
    if (!s_power_initialized) return ZX_ERR_UNAVAILABLE;

    for (uint32_t i = 0; i < MAX_WAKE_LOCKS; i++) {
        if (s_wake_locks[i].active && s_wake_locks[i].id == lock_id) {
            s_wake_locks[i].active = false;
            return ZX_OK;
        }
    }

    return ZX_ERR_NOT_FOUND;
}

uint32_t power_get_active_wake_locks(void) {
    uint32_t count = 0;
    for (uint32_t i = 0; i < MAX_WAKE_LOCKS; i++) {
        if (s_wake_locks[i].active) {
            count++;
        }
    }
    return count;
}
