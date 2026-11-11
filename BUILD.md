# PravahOS Toolchain & Build Guide

Building PravahOS (based on Zircon microkernel and Fuchsia component tooling) requires an ARM64 cross-compilation environment and QEMU for emulation.

---

## 1. Prerequisites

### Option A: Windows Native
1. **QEMU for Windows** (provides `qemu-system-aarch64`):
   ```powershell
   winget install SoftwareFreedomConservancy.QEMU
   ```
2. **LLVM / Clang** (targets `aarch64-unknown-none-elf`):
   ```powershell
   winget install LLVM.LLVM
   ```
3. **Ninja Build Tool & CMake**:
   ```powershell
   winget install Ninja-build.Ninja
   winget install Kitware.CMake
   ```

### Option B: Windows Subsystem for Linux (WSL2 / Ubuntu Recommended for Kernel Work)
```bash
wsl --install -d Ubuntu
sudo apt update && sudo apt install -y build-essential clang llvm lld qemu-system-arm ninja-build git python3
```

---

## 2. Emulation Target Profile: ARM64 QEMU `virt`

| Parameter | Configuration |
| :--- | :--- |
| **Machine** | `virt,gic-version=3` |
| **CPU** | `cortex-a76` or `max` (ARMv8.2-A / ARMv9-A) |
| **Memory** | 4GB minimum (`-m 4096M`) |
| **Console** | Serial UART (`-nographic -serial mon:stdio`) |
| **Kernel Binary** | `zircon.bin` (or PravahOS unified boot image) |

Run command:
```powershell
qemu-system-aarch64 -M virt,gic-version=3 -cpu cortex-a76 -m 4096M -nographic -kernel zircon.bin
```
