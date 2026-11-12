#!/system/bin/sh
# PravahOS Gesture Bridge: Bridges AOSP / Pixel swipe-up directly to Windows Metro Drawer
logcat -c
logcat -v raw -s StatsLog:D | while read -r line; do
  case "$line" in
    *LAUNCHER_ALLAPPS_OPEN_UP*)
      am start -n org.pravah.launcher/.MainActivity --ez auto_expand true >/dev/null 2>&1
      ;;
  esac
done
