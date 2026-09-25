/**
 * Device profiles for CrossInk readers, mirrored from
 * CrossInk web/pages/files.js DEVICE_PROFILES. The X4/X3 tags arrive via
 * the basic-auth username ("user#X4").
 */
export const DEVICE_PROFILES = {
  X4: { width: 480, height: 800 },
  X3: { width: 528, height: 792 },
} as const;

export type DeviceProfile = (typeof DEVICE_PROFILES)[keyof typeof DEVICE_PROFILES];
