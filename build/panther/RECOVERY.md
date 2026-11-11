# Google Pixel 7 ("panther") Device Identification, Recovery, & Factory Restore Runbook

**Authoritative Engineering Guide for Physical Silicon Bringup & Emergency Recovery**  
**Target Device**: Google Pixel 7 (`panther` / Google Tensor G2 GS201)  
**Foundation**: Foundation 1 (AOSP/Linux GKI Base + Native `pravahd` + Pravah UI)

---

## 1. Physical Device Identification & Unlock Eligibility

Before connecting any physical device to a flashing workstation, verify the exact hardware variant and carrier-unlock status.

### 1.1 Hardware Variant Matrix

| Model Number | Region / SKU | Cellular Bands | Bootloader Unlock Eligibility |
| :--- | :--- | :--- | :--- |
| **`GVU6C`** | Global / US Unlocked | Sub-6 GHz 5G (FR1) | **Eligible** (OEM unlock allowed) |
| **`GQML3`** | US Carrier-Unlocked | Sub-6 + mmWave 5G (FR1 + FR2) | **Eligible** (OEM unlock allowed) |
| **`GE2AE`** | Verizon Wireless SKU | Sub-6 + mmWave | **PERMANENTLY LOCKED** (Do NOT use) |

> [!CAUTION]
> **Carrier-Locked Warning**: Units sold through carrier financing (especially Verizon or AT&T contracts) have the **OEM Unlocking** toggle permanently disabled in bootloader NVRAM. Attempting to unlock these devices is physically impossible. Ensure your Pixel 7 is an official Google Store Unlocked unit.

### 1.2 Verifying OEM Unlock in Android Settings
1. Navigate to: `Settings` $\rightarrow$ `About phone` $\rightarrow$ Tap `Build number` 7 times to enable Developer Options.
2. Navigate to: `Settings` $\rightarrow$ `System` $\rightarrow$ `Developer options`.
3. Check the **OEM unlocking** switch:
   - If togglable: Enable it. The device is ready for fastboot unlocking.
   - If greyed out ("Unavailable on carrier-locked devices"): Stop. The device cannot be flashed.

---

## 2. Bootloader & Fastboot Mode Entry

### 2.1 Hardware Key Combination
1. Disconnect the USB cable and power down the Pixel 7 completely.
2. Press and hold **`Volume Down` + `Power`** simultaneously.
3. Keep holding until the screen lights up with the Android Fastboot graphic.
4. The Fastboot screen will display:
   ```text
   Product name: panther
   Variant: panther-gvu6c-128gb
   Bootloader version: cloudripper-1.0-...
   Baseband version: g5300g-...
   Secure boot: PRODUCTION
   Device state: locked (or unlocked)
   ```

### 2.2 Workstation Verification
Connect the Pixel 7 via USB-C to the development workstation and run:
```bash
fastboot devices
```
Expected output:
```text
2A151FDH20000B    fastboot
```

---

## 3. Bootloader Unlock & AVB 2.0 Custom Root-of-Trust

### 3.1 Unlocking the Bootloader
```bash
# Unlock standard partitions (erases all user data)
fastboot flashing unlock

# Unlock critical partitions (enables custom AVB key flashing)
fastboot flashing unlock_critical
```
*Follow on-screen prompt: Use `Volume` keys to select "Unlock the bootloader" and press `Power`.*

### 3.2 Titan M2 Custom Root-of-Trust Enrollment
The Google Pixel 7's Titan M2 security coprocessor supports physical enrollment of a custom AVB 2.0 root key. This allows PravahOS to boot with verified boot guarantees without yellow or red security warning screens:
```bash
# Erase stock OEM Google root key requirement
fastboot erase avb_custom_key

# Flash PravahOS AVB Custom Root-of-Trust key
fastboot flash avb_custom_key build/panther/keys/pravah_avb_custom_key.bin
```

---

## 4. Flashing PravahOS Artifacts

Once images are generated via `build/panther/build_kernel.sh`:
```bash
# Flash kernel boot image to both A/B slots
fastboot flash boot_a out/panther/pravah_boot.img
fastboot flash boot_b out/panther/pravah_boot.img

# Flash vendor boot image (with compiled pantah.dtb)
fastboot flash vendor_boot_a out/panther/pravah_vendor_boot.img
fastboot flash vendor_boot_b out/panther/pravah_vendor_boot.img

# Set active slot to A and boot
fastboot set_active a
fastboot reboot
```

---

## 5. Emergency Recovery & Factory Restore (Un-bricking)

If the device encounters a boot-loop, black screen, or corrupted partition state, use one of the two authoritative recovery paths to restore the phone to 100% factory Google stock firmware.

### Method A: Google Official Web USB Flasher (Zero-Tool Setup)
1. Put the Pixel 7 into Fastboot Mode (`Power` + `Vol Down`).
2. Connect to a PC running Google Chrome or Chromium.
3. Open: [`https://flash.android.com`](https://flash.android.com).
4. Grant WebUSB access to your device.
5. Select the latest official Google Pixel 7 factory build.
6. Check "Wipe Device" and "Force Flash all Partitions".
7. Click **Install build**. The tool will automatically restore all bootloader, modem, radio, system, vendor, and Titan M2 partitions.

### Method B: Standalone Factory Image Flash (`flash-all.sh` / `flash-all.bat`)
1. Download the official Pixel 7 factory image archive from Google Developers:
   `https://developers.google.com/android/images#panther`  
   (e.g., `panther-uq1a.240205.002-factory-*.zip`).
2. Unpack the zip archive on your workstation.
3. Open a terminal in the unpacked directory.
4. Erase any custom AVB key:
   ```bash
   fastboot erase avb_custom_key
   ```
5. Execute the official flash-all script:
   - On Linux/macOS:
     ```bash
     ./flash-all.sh
     ```
   - On Windows:
     ```powershell
     .\flash-all.bat
     ```
6. The script re-flashes `bootloader`, `radio`, `boot`, `dtbo`, `vendor_boot`, `init_boot`, and `super` partitions.
7. (Optional) Re-lock the bootloader once stock firmware is restored:
   ```bash
   fastboot flashing lock
   ```

---

## 6. Anti-Rollback & Fuse Protection Rules

> [!WARNING]
> **Anti-Rollback Fuse Policy**:
> Google Tensor G2 permanently burns anti-rollback increment counters into the Titan M2 hardware security enclave with each major Android security patch level.
> - **Never** attempt to flash factory images older than the device's currently installed security patch level.
> - Flashing a bootloader with a lower anti-rollback version will cause the Titan M2 to fail verification and permanently halt the CPU (`TITAN_M2_ERR_ROLLBACK_DETECTED`).
