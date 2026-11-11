# PravahOS Engineering Roadmap

## Completed Milestones

### Milestone 1: Core Foundation & Capability Contracts
- [x] Create Architectural Decision Record (ADR 0001: Pivot from XNU to Fuchsia/Zircon in [`DECISIONS.md`](DECISIONS.md))
- [x] Define Master Architecture (`ARCHITECTURE.md`)
- [x] Establish Core System FIDL protocols (`pravah.capability`, `pravah.task`, `pravah.policy`, `pravah.inference`)

### Milestone 2: Microkernel PMM, VMM & Process Loader
- [x] Implement Physical Memory Manager (PMM bitmap page allocation)
- [x] Implement Virtual Memory Manager (VMM 4-level paging & demand fault handling)
- [x] Implement ELF64 EL0 userspace process loader and capability handle tables
- [x] Implement ARM64 EL1 bootloader and PL011 UART serial drivers

### Milestone 3: Deterministic Policy Gate & Task Runtime
- [x] Build multi-tier risk arbitration engine (`READ_ONLY`, `REVERSIBLE`, `CONSEQUENTIAL`, `IRREVERSIBLE`)
- [x] Build context-aware security gate preventing prompt injection bypasses
- [x] Build topological DAG scheduler with dependency checkpoints and rollback
- [x] Implement tamper-evident SHA-256 cryptographic audit ledger

### Milestone 4: Mobile HAL, Display & Compositor
- [x] Implement Display Driver & Linear Framebuffer compositor (ARGB8888, double-buffering)
- [x] Implement Input Digitizer & Multi-Touch Gesture Decoder (tap, double-tap, long-press, swipe, pinch)
- [x] Implement Mobile HAL Sensory Bridge: Sony IMX890 50MP Camera, 48kHz Audio DMA, Battery & Thermal Governor, 0.0V Physical RF Killswitch

### Milestone 5: Consumer Delight & Tactile Motion Physics
- [x] Build analytical Spring physics solver (underdamped, critically damped, overdamped)
- [x] Build Apple/Android rubberband formula with exact analytical inverse
- [x] Implement Dynamic Island with liquid squircle morphing between compact, music, flight, and alert states
- [x] Implement synthesized Web Audio tactile haptic engine (light tap, medium snap, heavy thud, notification buzz)
- [x] Implement Mobile Soft Keyboard (IME) with predictive n-gram completions and voice dictation FFT spectrogram visualizer

### Milestone 6: Zero-Tax Android Compatibility
- [x] Build 4-stage install-time AOT APK transpiler
- [x] Implement wake-lock stripper and native `.capability` synthesizer
- [x] Build Dormancy Supervisor enforcing 0.00% CPU and 0 MB active RAM idle micro-containers

### Milestone 7: Control Center & Hardware Shade
- [x] Build top pull-down Control Center with quick toggles (Torch PWM, Air-Gap, Wi-Fi 7, Sensor Privacy Kill)
- [x] Implement NPU Power Governor cycling `ECO` (INT4, 0.4W) $\to$ `BALANCED` (INT8, 1.2W) $\to$ `BOOST` (FP16, 3.8W)
- [x] Implement interactive display brightness dimming overlay and volume sliders
- [x] Build Pulse Zero-Spam Live Feed (only active DAG milestones and urgent hardware state)

### Milestone 8: Neo-Metro Living Drawer & Consumer UI Overhaul
- [x] Eliminate programmer console aesthetic in favor of luxury liquid-glass consumer UI with ambient drifting glow orbs and organic squircles
- [x] Redesign Living Drawer into modern Bento Grid:
  - 2x1 Hero Spotify tile with continuously rotating vinyl disc and 7-band soundwave ribbon
  - Flight AI-202 tile with 360° rotating radar sweep scope
  - Power Fuel Capsule gauge synced with NPU quantization profiles
  - Floating glass prism alphabet jump picker with illuminated letter beacons

### Milestone 9: Foldable & Passport Form Factor Architecture
- [x] Build Hardware Hinge Sensor HAL (`kernel/include/kernel/hal/hinge.h`) tracking $0^\circ \dots 180^\circ$ continuous angle
- [x] Implement 0.0V inner display power rail gating when folded shut
- [x] Build Dual-Spine Adaptive Canvas in 4:3 Passport mode ($780 \times 680$) and 90° Flex tabletop mode
- [x] Add interactive Form Factor Switchers in Phone Emulator (`[ 📱 Slab ]`, `[ 📖 Passport ]`, `[ 📐 Flex ]`)

### Milestone 10: Daily-Driver Essentials & Predictive Back Navigation
- [x] Implement 1Hz OLED True-Black (0.00W) Always-On Display (AOD)
- [x] Implement Biometric Lockscreen with in-display ultrasonic fingerprint sensor and corner shortcuts (Torch 🔦 & Camera 📷)
- [x] Implement Telecom Phone Dialer with T9 keypad and On-Device INT4 Neural Call Screening for robocalls
- [x] Implement Android-style Universal Predictive Back Gesture with dual-edge inward swipe, liquid pill indicator, and hierarchical OS back stack

---

## Future Horizons (Phase 4+)

- [ ] **Bare-Metal Device Flashing**: Build `fastboot`-compatible partition image (`system.img`, `boot.img`) targeting Qualcomm Snapdragon 8 Gen 2 / Gen 3 hardware devices.
- [ ] **Satellite SOS Air-Gap Link**: Implement NTN (Non-Terrestrial Network) 3GPP Rel-17 direct-to-satellite text messaging capability via Iridium / Starlink constellation.
- [ ] **Secure Enclave Biometric Co-Processor**: Isolate fingerprint and iris cryptographic keys into dedicated ARM TrustZone EL3 secure world enclave.
