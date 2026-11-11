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

### Milestone 11: Multi-SoC Silicon Bringup & 3GPP Rel-17 Satellite SOS
- [x] Build Qualcomm Snapdragon 8 Gen 2/3 (SM8550/SM8650) Fastboot partition flashing script and dry-run simulator (`tools/flash_device.ps1`, `SILICON_BRINGUP.md`)
- [x] Build Google Tensor G2/G3/G4 bringup specification with Cortex-X3/X4 clusters and **Titan M2 Security Chip** Custom Root-of-Trust (RoT) enrollment
- [x] Implement 3GPP Rel-17 NTN direct-to-satellite emergency messaging subsystem with slant range, Free Space Path Loss (FSPL), Doppler pre-compensation, and 128-byte binary packet serialization
- [x] Implement RF air-gap safety interlock grounding terrestrial radios to 0.0V during emergency NTN burst transmissions

### Milestone 12: Flagship Core Stock Applications Suite ("Find Best, Port & Make Better")
- [x] Implement Universal Stock App Runner (`ui/apps/app_runner.js`) with frosted glassmorphic bottom sheet modals and back gesture integration
- [x] Build Phone & Smart T9 Dialer (`ui/apps/dialer.js`) with Fossify instant T9 search, in-call screen, and AI Call Screening
- [x] Build Messages & Air-Gap SMS (`ui/apps/messages.js`) with ML-KEM-768 post-quantum cryptographic envelopes, delivery ticks, and scheduled messaging
- [x] Build Gallery & AI Photos (`ui/apps/gallery.js`) with offline optical OCR neural search, EXIF privacy scrubber, and Titan M2 locked safe album
- [x] Build Files & Storage Manager (`ui/apps/files.js`) with real-time capacity breakdown gauge, ZIP archive inspector, and `/vault` PIN gating
- [x] Build Calculator & Live Math (`ui/apps/calculator.js`) with Soulver-style live preview evaluation, zero floating-point roundoff drift (`0.1 + 0.2 = 0.3`), scientific trigonometry, and pegged offline currency/unit converter
- [x] Build Clock, Timer & World Clocks (`ui/apps/clock.js`) with multi-alarm scheduler, world clock UTC differentials (`+5:30h`, `-5h`), Dynamic Island live timer synchronization, and millisecond stopwatch split-lap highlighting
- [x] Integrate all 6 stock apps into the Consumer Dock, Home Screen squircle grid, and Living Drawer A-Z Metro catalog with 423/423 automated tests passing

---

## Future Horizons (Phase 4+)

- [ ] **Physical Silicon Flashing Rig**: Connect physical Pixel 8 / Galaxy S23 via USB-C EDL / Fastboot cable to execute physical partition flash.
- [ ] **Decentralized Mesh Networking**: Direct peer-to-peer Wi-Fi Aware & Bluetooth LE capability sync across offline PravahOS devices without infrastructure routers.
- [ ] **Multi-Window Desktop Mode**: DisplayPort over USB-C automatic dock detection into desktop floating windowing manager.
