/**
 * Device-to-zone mapping.
 *
 * Worth being explicit about, because it is the one thing Ring cannot tell us.
 * Ring knows it has a device with an ID that saw motion. It has no idea that the
 * device is in a hallway, and no idea that a hallway is inside the house.
 *
 * "Zone" is therefore our concept, supplied by whoever set the household up, and
 * the interior/exterior distinction that the entire occupancy model rests on
 * lives in HouseholdConfig.interiorZones. Getting this mapping wrong is silent
 * and serious: label the front-door camera as a hallway and passing traffic
 * starts counting as evidence the resident is awake.
 */

export type DeviceRegistry = ReadonlyMap<string, string>;

export function buildDeviceRegistry(mapping: Readonly<Record<string, string>>): DeviceRegistry {
  return new Map(Object.entries(mapping));
}

export function zoneForDevice(registry: DeviceRegistry, deviceId: string): string | undefined {
  return registry.get(deviceId);
}

/**
 * Devices Ring told us about that nobody has placed in a zone yet.
 *
 * These must surface in the UI rather than being quietly dropped. An unmapped
 * camera is a blind spot the household does not know it has, and our own
 * observability check would happily report a zone as covered while ignoring the
 * device watching it.
 */
export function unmappedDevices(
  registry: DeviceRegistry,
  discoveredDeviceIds: readonly string[],
): string[] {
  return discoveredDeviceIds.filter((id) => !registry.has(id));
}
