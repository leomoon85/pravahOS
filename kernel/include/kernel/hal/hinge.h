/**
 * @file hinge.h
 * @brief PravahOS Foldable, Flip & Passport Form Factor Hinge Sensor HAL.
 *
 * Provides physical hinge telemetry (angle in millidegrees, angular velocity, posture state),
 * multi-display power rail gating (0.0V inner panel isolation when closed),
 * and adaptive form factor classification (Candybar, Passport Booklet, Clamshell Flip, Tri-Fold).
 */

#ifndef PRAVAH_KERNEL_HAL_HINGE_H
#define PRAVAH_KERNEL_HAL_HINGE_H

#include "kernel/types.h"
#include "kernel/memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Form Factor Enums & Posture Constants                                     */
/* ========================================================================= */

/**
 * Supported physical chassis form factor families.
 */
typedef enum {
    CHASSIS_FORM_FACTOR_CANDYBAR         = 0, /**< Standard monolithic 20:9 slab phone */
    CHASSIS_FORM_FACTOR_PASSPORT_FOLD    = 1, /**< Squarish 4:3 / 1:1 wide booklet fold */
    CHASSIS_FORM_FACTOR_CLAMSHELL_FLIP   = 2, /**< Compact vertical clamshell flip */
    CHASSIS_FORM_FACTOR_TRIFOLD          = 3  /**< Next-gen dual-hinge tri-fold expansive canvas */
} chassis_form_factor_t;

/**
 * Discrete hinge posture states derived from angular sensors with hysteresis.
 */
typedef enum {
    HINGE_POSTURE_CLOSED                 = 0, /**< 0° - 15°: Outer cover screen active, inner display 0.0V */
    HINGE_POSTURE_PEEK                   = 1, /**< 15° - 45°: Cover notification peek, low-power glance */
    HINGE_POSTURE_FLEX_TABLETOP          = 2, /**< 60° - 120°: L-shape tabletop mode (top viewport, bottom deck) */
    HINGE_POSTURE_OPEN_PASSPORT          = 3, /**< 135° - 180°: Unfolded wide canvas / dual-pane adaptive workspace */
    HINGE_POSTURE_TENT                   = 4  /**< > 180° / Tent mode: Stand mode for hands-free media */
} hinge_posture_t;

/**
 * Display panel power rail states.
 */
typedef enum {
    PANEL_POWER_STATE_OFF                = 0, /**< 0.0V VDD rail isolation (zero idle current) */
    PANEL_POWER_STATE_1HZ_AOD            = 1, /**< 1Hz low-frequency Always-On Display glance state */
    PANEL_POWER_STATE_FULL_ACTIVE        = 2  /**< Full 120Hz LTPO OLED active surface */
} panel_power_state_t;

/* ========================================================================= */
/* Telemetry & Sensor Calibration Data Structures                            */
/* ========================================================================= */

/**
 * Real-time continuous hinge telemetry packet.
 */
typedef struct {
    uint32_t              hinge_index;            /**< 0 for primary hinge, 1 for secondary (tri-fold) */
    int32_t               angle_millidegrees;     /**< Angle in millidegrees (e.g. 180000 = 180.00°) */
    int32_t               angular_velocity_deg_s; /**< Opening (+) or closing (-) speed in degrees/sec */
    hinge_posture_t       posture;                /**< Current discrete filtered posture */
    chassis_form_factor_t form_factor;            /**< Physical hardware chassis type */
    panel_power_state_t   outer_panel_state;      /**< Cover screen power rail */
    panel_power_state_t   inner_panel_state;      /**< Main folding screen power rail */
    bool                  crease_mitigation;      /**< True if OLED pixel warp shader is active at fold seam */
    uint64_t              timestamp_ns;           /**< Monotonic timestamp of sensor sample */
} hinge_telemetry_t;

/**
 * Seam and display geometry descriptor for dual-pane and crease compensation.
 */
typedef struct {
    uint32_t hinge_split_x_px;    /**< X coordinate of hinge center line on inner panel */
    uint32_t hinge_crease_width_px;/**< Physical radius of the hinge radius curve (e.g. 24px) */
    uint32_t left_pane_width_px;  /**< Usable width of left spine / canvas */
    uint32_t right_pane_width_px; /**< Usable width of right spine / canvas */
    uint32_t canvas_height_px;    /**< Active canvas height */
} fold_geometry_t;

/* ========================================================================= */
/* Hinge Driver Operations Interface                                         */
/* ========================================================================= */

typedef void (*hinge_posture_callback_t)(const hinge_telemetry_t* telemetry, void* context);

typedef struct {
    zx_status_t (*init)(void);
    zx_status_t (*read_telemetry)(uint32_t hinge_index, hinge_telemetry_t* out_telemetry);
    zx_status_t (*set_posture_callback)(hinge_posture_callback_t cb, void* context);
    zx_status_t (*get_fold_geometry)(fold_geometry_t* out_geometry);
    zx_status_t (*gate_panel_power)(bool inner_active, bool outer_active);
    zx_status_t (*set_simulated_angle)(uint32_t hinge_index, int32_t angle_millidegrees);
} hinge_hal_ops_t;

/**
 * Retrieves the singleton Hinge HAL driver dispatch table.
 */
const hinge_hal_ops_t* pravah_hal_get_hinge_ops(void);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_HAL_HINGE_H */
