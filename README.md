# PravahOS (प्रवाह)

> **AI-Native • Capability-Centric • Offline-First • Zero-Tax Autonomous Mobile Operating System**
> Built on Google Fuchsia / Zircon Microkernel Foundation with ARM64 Target Architecture.

[![Automated Tests](https://img.shields.io/badge/Automated%20Tests-267%2F267%20Passing-00f0ff?style=for-the-badge&logo=checkmarx)](file:///l:/projectz/OS)
[![Microkernel](https://img.shields.io/badge/Microkernel-Fuchsia%2FZircon%20EL1-8b5cf6?style=for-the-badge)](file:///l:/projectz/OS/DECISIONS.md)
[![Design](https://img.shields.io/badge/UI%20Language-Liquid%20Glass%20%2B%20Neo--Metro-10b981?style=for-the-badge)](file:///l:/projectz/OS/DRAWER.md)
[![Hardware](https://img.shields.io/badge/Chassis-Passport%20Fold%20%7C%20Flex%20%7C%20Slab-f59e0b?style=for-the-badge)](file:///l:/projectz/OS/FOLDABLE.md)

---

## 1. Vision & Philosophy

Modern mobile operating systems (Android, iOS) were conceived in 2007 around a desktop metaphor: a passive grid of application icons that hoard user attention, run 40+ unmonitored background wake-locks, leak telemetry to remote clouds, and bombard users with 80+ marketing push notifications per day.

**PravahOS** completely redesigns the mobile operating system from first principles:
1. **Intent-to-DAG Orchestration**: You declare an intent (*"Check flight AI-202, book hotel near arrival, and set alarm 2h before"*); PravahOS plans a deterministic Directed Acyclic Graph (DAG) and executes it through native capabilities without app hopping.
2. **Deterministic Capability Security**: The AI model is **never** the security authority. All capabilities are gated by the Zircon Policy Gate (`READ_ONLY`, `REVERSIBLE`, `CONSEQUENTIAL`, `IRREVERSIBLE`) and logged in a tamper-evident SHA-256 forward hash chain.
3. **Zero-Tax Compatibility**: Rather than running resource-heavy Android VMs (burning 2–3 GB RAM and idle battery), PravahOS uses **Install-Time AOT Transpilation**. APKs are decomposed into declarative capabilities, while un-transpiled logic remains in a 100% frozen micro-container (0.00% CPU, 0 MB active RAM).
4. **Offline-First & True Air-Gap**: All core neural models (quantized INT4/INT8 speech and intent transformers) run locally on the SoC NPU. A physical hardware killswitch drops all RF rails to 0.0V.

---

## 2. Complete System Architecture

```
+-----------------------------------------------------------------------------------+
|                        DYNAMIC EXPERIENCE COMPOSER (DEC)                          |
|    Liquid Glassmorphism • Neo-Metro Bento Grid • Dynamic Island • Predictive Back |
+-----------------------------------------------------------------------------------+
                                          ▲
                                          │ FIDL IPC
+-----------------------------------------┴-----------------------------------------+
|                        UNIFIED INTELLIGENCE AUTHORITY (UIA)                       |
|   Deterministic Policy Gate • Task DAG Engine • Tamper-Evident SHA-256 Ledger     |
+-----------------------------------------┬-----------------------------------------+
       │ FIDL                                    │ FIDL                        │ FIDL
       ▼                                         ▼                             ▼
+-----------------------------+   +-----------------------------+   +---------------+
| SPECIALIST INFERENCE FABRIC |   |  CAPABILITY & RESOURCE HAL  |   | CONTEXT/MEMORY|
| - On-Device INT4 Whisper    |   | - Multi-Display / Hinge HAL |   | - Episodic    |
| - Offline Intent Parser     |   | - Direct Audio HAL (48kHz)  |   | - Semantic    |
| - AI Call Screening Engine  |   | - Sony IMX890 Camera VMO    |   | - Task Ledger |
+-----------------------------+   +-----------------------------+   +---------------+
                                          ▲
                                          │ Zircon Channels & Capability Routing
+-----------------------------------------┴-----------------------------------------+
|                      FUCHSIA COMPONENT FRAMEWORK (CFv2)                           |
|       Sandboxing  •  Capability Routing (.cml)  •  Zero-Tax Dormant Supervisor    |
+-----------------------------------------------------------------------------------+
|                       USERSPACE DRIVER FRAMEWORK (DFv2)                           |
|    Isolated Driver Hosts (NPU, Adreno/Mali GPU, Touch, Display, Modem, Hinge)     |
+-----------------------------------------------------------------------------------+
|                              ZIRCON MICROKERNEL                                   |
|  Handles & Rights Masks  •  Channels & Ports  •  VMOs  •  ARM64 Scheduler & Syscalls|
+-----------------------------------------------------------------------------------+
|                     TARGET HARDWARE: ARM64 (QEMU & QUALCOMM SOC)                  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Key Subsystems & Breakthrough Features

### 📖 Foldable & Passport Form Factors
- **Continuous Hinge Sensor HAL** ([`kernel/include/kernel/hal/hinge.h`](kernel/include/kernel/hal/hinge.h)):
  Monitors physical hinge angle $\theta \in [0^\circ, 180^\circ]$ across `CLOSED` ($0^\circ$), `PEEK` ($15^\circ..45^\circ$), `FLEX_TABLETOP` ($60^\circ..120^\circ$), and `OPEN_PASSPORT` ($135^\circ..180^\circ$).
- **Zero-Watt Power Gating**: Isolates the inner 120Hz LTPO display power rail to 0.0V when folded shut.
- **Dual-Spine Adaptive Canvas**: When unfolded into the squarish 4:3 Passport ratio ($780 \times 680$), PravahOS splits into a dual-column workspace:
  - *Left Spine*: Intent Bar, Dynamic Island, and Task DAG Stages.
  - *Center*: Subtle OLED seam with crease shadow mitigation.
  - *Right Spine*: Live Interactive Outcome Cards (Boarding pass with dynamic QR, Lossless Spotify audio player with rotating vinyl, and Trust Shield ledger).

### ◂ Android-Style Universal Predictive Back Gesture
- **Edge Inward Swipe**: Initiates seamlessly within $\le 32$px of either the left or right screen border.
- **Predictive Back Indicator**: Liquid squircle pill with animated directional SVG arrow that stretches using rubberband physics.
- **Hierarchical OS Unwind Stack**: Committing the gesture ($\ge 48$px) unwinds active surfaces deterministically:
  1. Approval Modal $\to$ 2. Call Screen $\to$ 3. Dialer $\to$ 4. Fast-Jump Modal $\to$ 5. Living Drawer $\to$ 6. Control Shade $\to$ 7. Keyboard $\to$ 8. Ephemeral Windows $\to$ 9. Task DAG $\to$ 10. Root Home.

### ⊞ Luxury Neo-Metro Living App Drawer
- **Bento Grid Architecture**: Replaces boxy 2012 Windows Phone tiles with organic 20–26px squircles, liquid frosted blur (`blur(32px) saturate(210%)`), and 3D pointer parallax tilt.
- **Dynamic Bento Hero Tiles**:
  - *Spotify 2x1 Hero*: Rotating vinyl disc (`@keyframes vinylSpin`), 7-band soundwave ribbon, and 5-bar live equalizer.
  - *Flight AI-202*: 360° rotating radar sweep scope with live countdown ticker.
  - *Power Fuel Capsule*: Gradient energy gauge synced with NPU quantization profiles.
  - *Air-Gap Badge*: Post-quantum ML-KEM-768 cryptographic status.
- **Floating Glass Prism Alphabet Picker**: 4x7 illuminated letter beacons with Nothing-style micro-dot indicators.

### ▾ Control Center & Hardware Shade
- Pull-down shade with instant hardware quick-toggles:
  - 🔦 **Torch**: True optical PWM cone beam simulation.
  - 🛡 **Air-Gap Killswitch**: Hardware RF rail drop (5G, Wi-Fi 7, Bluetooth 5.4, NFC/UWB).
  - ⚡ **NPU Power Governor**: Cycles `ECO` (INT4, 800MHz, 0.4W) $\to$ `BALANCED` (INT8, 1400MHz, 1.2W) $\to$ `BOOST` (FP16, 2200MHz, 3.8W).
  - 🔒 **Sensor Privacy Kill**: Drops Camera VDD and Microphone bias rails to 0.0V.
  - 🎚 **Fluid Sliders**: Volume and Display Brightness with real-time dimming overlays.

### 🔒 1Hz Always-On Display (AOD) & Biometric Lockscreen
- **OLED True-Black (0.00W) 1Hz AOD**: Ultra-low-frequency scanline rendering minimal clock, battery pill, and flight/music live glance indicators.
- **Lock Screen**: Fluid wallpaper glow, lock status glyph, and corner shortcuts (Torch 🔦 and Camera 📷).
- **In-Display Ultrasonic Biometric Sensor**: Pressing or holding the scanner emits a cyan sonic ripple wave and unlocks into the home workspace with tactile haptics.

### 📞 Telecom Phone Dialer & On-Device AI Call Screening
- **Tactile T9 Keypad**: Instant contact search across names and digits with haptic feedback.
- **Offline INT4 Neural Call Screener**: Real-time on-device speech-to-text transcribes unknown robocalls with **zero audio data leaving the phone**.
- **Deterministic Spam Gating**: Classifies caller intent (*"Loan settlement pre-approval..."*), displays `Spam Likelihood: 99%`, and provides a one-tap `[ 🛡 Block & Drop ]` action.

### 📦 Zero-Tax AOT APK Transpiler & Dormancy Supervisor
- Strips Android wake-locks and advertising SDKs at install-time.
- Synthesizes native `.capability` descriptors (`ride.request`, `media.playback.stream`, `messaging.send`).
- Un-transpiled logic remains 100% frozen in a dormant micro-container (0.00% CPU, 0 MB active RAM).

---

## 4. Interactive Phone Emulator

PravahOS includes a high-fidelity browser-based phone emulator modeling real ARM64 hardware:

1. Open [`emulator/index.html`](emulator/index.html) in any modern browser.
2. Experience:
   - **Form Factor Switcher**: Click `[ 📱 Slab ]`, `[ 📖 Passport ]`, or `[ 📐 Flex ]` in the top toolbar to watch the chassis morph with animated spring transitions.
   - **Universal Back Gesture**: Swipe inward from the left or right edge of the screen, or click `[ ◂ Back ]`.
   - **Living Drawer**: Swipe up from the bottom pill or click `[ ⊞ Living Drawer ]` to explore the Neo-Metro Bento Grid.
   - **Hardware Shade**: Swipe down from the top status bar or click `[ ▾ Control Shade ]`.
   - **Hardware Power Button**: Click the right-side physical power button to enter the 1Hz AOD and test the in-display ultrasonic fingerprint scanner.
   - **Interactive Camera**: Click `[ 📷 Camera ]` to launch the live IMX890 viewfinder.
   - **AOT APK Installer**: Click `[ 📦 AOT Installer ]` to transpire Uber, Spotify, or custom APKs.

---

## 5. Verification & Test Suite

All subsystems are verified with automated unit and integration tests:

```powershell
# Run the complete test suite (runtime, ui, and emulator)
node --test runtime/tests/*.test.js ui/tests/*.test.js emulator/tests/*.test.js
```

### Test Suite Summary:
- **Total Tests Passing**: **267 / 267** (100% pass rate)
- **Total Test Suites**: **24 suites**
- **Test Execution Time**: $\approx 1.5$ seconds
- **Regressions**: **0**

| Subsystem Suite | Test File | Tests Passed |
| :--- | :--- | :--- |
| **Android Bridge & Containers** | `emulator/tests/android_bridge.test.js` | 7 / 7 |
| **Phone Digitizer & Gestures** | `emulator/tests/emulator.test.js` | 17 / 17 |
| **AOT APK Transpiler** | `emulator/tests/installer.test.js` | 17 / 17 |
| **Sensory Bridge & HAL** | `emulator/tests/sensory_bridge.test.js` | 18 / 18 |
| **Dynamic Island & Haptics** | `ui/tests/island_haptics.test.js` | 18 / 18 |
| **Virtual IME Keyboard & Voice** | `ui/tests/keyboard.test.js` | 17 / 17 |
| **Living Drawer & Neo-Metro** | `ui/tests/drawer.test.js` | 19 / 19 |
| **Control Shade & Toggles** | `ui/tests/shade.test.js` | 15 / 15 |
| **Universal Back Gesture** | `ui/tests/back_gesture.test.js` | 7 / 7 |
| **Foldable & Passport HAL** | `ui/tests/foldable.test.js` | 3 / 3 |
| **1Hz AOD & Lockscreen** | `ui/tests/lockscreen.test.js` | 5 / 5 |
| **Telecom Dialer & Call Screener** | `ui/tests/dialer.test.js` | 4 / 4 |
| **Microkernel & Runtime Engine** | `runtime/tests/runtime.test.js` | 27 / 27 |
| **DEC UI Composer & Schema** | `ui/tests/composer.test.js` | 11 / 11 |

---

## 6. Project Documentation Index

- [`ARCHITECTURE.md`](ARCHITECTURE.md): System architecture, FIDL IPC protocols, and microkernel layering.
- [`DECISIONS.md`](DECISIONS.md): Architectural Decision Records (ADR 0001: XNU to Fuchsia/Zircon migration).
- [`FOLDABLE.md`](FOLDABLE.md): Hinge HAL, discrete postures, seam anti-crease, and dual-pane layout.
- [`DRAWER.md`](DRAWER.md): Neo-Metro design philosophy, Bento Grid, rotating vinyl, and 3D tilt.
- [`SHADE.md`](SHADE.md): Control Center, power profiles, RF air-gap, and hardware sliders.
- [`CONTAINER.md`](CONTAINER.md): Starnix-style zero-tax micro-containers and dormacy invariants.
- [`TRANSPILER.md`](TRANSPILER.md): 4-stage AOT APK capability synthesizer.
- [`HAL.md`](HAL.md): Hardware Abstraction Layer for Audio, Camera, Telephony, and Power.
- [`KERNEL.md`](KERNEL.md): Zircon PMM, VMM, handle rights, and thread dispatch table.
- [`ROADMAP.md`](ROADMAP.md): Engineering milestone roadmap and long-term horizons.

---

## 7. License

Copyright 2026 The PravahOS Authors. All rights reserved.  
Distributed under the BSD-style license.
