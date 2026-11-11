/**
 * @file telephony.h
 * @brief PravahOS Mobile Cellular Telephony & Baseband Modem HAL.
 *
 * Implements cellular baseband modem control, Dual-SIM Dual-Standby (DSDS) state
 * tracking, 4G-LTE / 5G-NR network registration, signal quality telemetry (RSSI,
 * RSRP, RSRQ), and hardware-isolated offline air-gap (flight) mode.
 */

#ifndef PRAVAH_KERNEL_HAL_TELEPHONY_H
#define PRAVAH_KERNEL_HAL_TELEPHONY_H

#include "kernel/types.h"
#include "kernel/memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Modem & SIM Identification                                                */
/* ========================================================================= */

#define TELEPHONY_MAX_SIM_SLOTS      (2)   /**< Dual SIM support (SIM1 primary, SIM2 secondary) */
#define TELEPHONY_SLOT_1             (0)
#define TELEPHONY_SLOT_2             (1)

#define TELEPHONY_ICCID_MAX_LEN      (24)  /**< SIM ICCID string length */
#define TELEPHONY_IMSI_MAX_LEN       (16)  /**< International Mobile Subscriber Identity */
#define TELEPHONY_OPERATOR_MAX_LEN   (32)  /**< Network operator / carrier name */
#define TELEPHONY_MODEM_MODEL_LEN    (32)

/* ========================================================================= */
/* Enums: Modem State, SIM State, Radio Access Tech, Registration            */
/* ========================================================================= */

typedef enum {
    MODEM_POWER_OFF        = 0, /**< Modem rail completely powered down */
    MODEM_POWER_LOW        = 1, /**< Ultra-low power / standby */
    MODEM_POWER_ONLINE     = 2, /**< Full radio TX/RX active */
    MODEM_POWER_AIRGAP     = 3  /**< Hardware baseband isolated (airplane mode) */
} modem_power_state_t;

typedef enum {
    SIM_STATE_ABSENT       = 0, /**< No physical SIM or eSIM profile */
    SIM_STATE_NOT_READY    = 1, /**< Powered up, reading EF files */
    SIM_STATE_READY        = 2, /**< Authenticated and active */
    SIM_STATE_PIN_REQUIRED = 3, /**< Blocked waiting for PIN1 */
    SIM_STATE_PUK_REQUIRED = 4, /**< Locked, requires PUK unlock code */
    SIM_STATE_ERROR        = 5  /**< Hardware or communication fault */
} sim_state_t;

typedef enum {
    RADIO_TECH_NONE        = 0,
    RADIO_TECH_GSM_2G      = 1, /**< 2G GSM / EDGE */
    RADIO_TECH_UMTS_3G     = 2, /**< 3G WCDMA / HSPA+ */
    RADIO_TECH_LTE_4G      = 3, /**< 4G LTE Advanced */
    RADIO_TECH_NR_5G_SUB6  = 4, /**< 5G NR Sub-6GHz (FR1) */
    RADIO_TECH_NR_5G_MMWAVE= 5  /**< 5G NR Millimeter Wave (FR2) */
} radio_access_tech_t;

typedef enum {
    REG_STATE_NOT_REGISTERED     = 0,
    REG_STATE_REGISTERED_HOME    = 1,
    REG_STATE_SEARCHING          = 2,
    REG_STATE_REGISTRATION_DENIED= 3,
    REG_STATE_REGISTERED_ROAMING = 4
} network_reg_state_t;

/* ========================================================================= */
/* Telephony Telemetry Structures                                            */
/* ========================================================================= */

typedef struct {
    int32_t             rssi_dbm;     /**< Received Signal Strength Indicator (-113 to -51 dBm) */
    int32_t             rsrp_dbm;     /**< Reference Signal Received Power (-140 to -44 dBm) */
    int32_t             rsrq_db;      /**< Reference Signal Received Quality (-20 to -3 dB) */
    int32_t             snr_db;       /**< Signal to Noise Ratio in dB (0 to 30 dB) */
    uint8_t             signal_bars;  /**< Visual indicator bars: 0 (No signal) to 5 (Full) */
    radio_access_tech_t rat;          /**< Active radio technology */
} cellular_signal_t;

typedef struct {
    uint32_t            slot_id;
    sim_state_t         sim_state;
    char                iccid[TELEPHONY_ICCID_MAX_LEN];
    char                imsi[TELEPHONY_IMSI_MAX_LEN];
    char                operator_name[TELEPHONY_OPERATOR_MAX_LEN];
    network_reg_state_t reg_state;
    cellular_signal_t   signal;
} sim_card_info_t;

typedef struct {
    modem_power_state_t power_state;
    bool                air_gap_mode; /**< True = Offline Flight / Baseband Isolated */
    char                modem_model[TELEPHONY_MODEM_MODEL_LEN];
    char                firmware_version[32];
    char                imei[16];
    uint32_t            active_sim_slots;
} modem_telemetry_t;

/* ========================================================================= */
/* Telephony HAL Public API                                                  */
/* ========================================================================= */

/**
 * @brief Initialize the Mobile Cellular Telephony HAL and Baseband Controller.
 */
zx_status_t telephony_hal_init(void);

/**
 * @brief Query current baseband modem operational profile and telemetry.
 */
zx_status_t telephony_get_modem_info(modem_telemetry_t *out_info);

/**
 * @brief Retrieve detailed state for a specific SIM slot (0 or 1).
 */
zx_status_t telephony_get_sim_info(uint32_t slot_id, sim_card_info_t *out_info);

/**
 * @brief Query current cellular signal strength telemetry for a SIM slot.
 */
zx_status_t telephony_get_signal_strength(uint32_t slot_id, cellular_signal_t *out_signal);

/**
 * @brief Toggle hardware baseband offline air-gap / airplane flight mode.
 *
 * @param enable When true, cuts RF power rails and isolates baseband bus.
 *               When false, powers up baseband transceiver and begins network search.
 */
zx_status_t telephony_set_airplane_mode(bool enable);

/**
 * @brief Query current airplane air-gap isolation status.
 */
bool telephony_get_airplane_mode(void);

/**
 * @brief Convert raw RSSI in dBm to standard 0-5 signal bars.
 */
uint8_t telephony_rssi_to_bars(int32_t rssi_dbm);

/**
 * @brief Simulate incoming network registration or signal update (for testing).
 */
zx_status_t telephony_simulate_network(uint32_t slot_id,
                                       network_reg_state_t reg_state,
                                       radio_access_tech_t rat,
                                       int32_t rssi_dbm);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_HAL_TELEPHONY_H */
