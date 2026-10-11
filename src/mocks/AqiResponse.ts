export interface AqiMessage {
  aqi: number | string | null;
  idx: number;
  city: { name: string; url: string; [key: string]: unknown };
  xsync: { gen: number; [key: string]: unknown };
  time: { s: string; iso: string; v: number; tz: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AqiResponse {
  rxs: {
    status: string;
    obs: { status: string; msg?: AqiMessage; [key: string]: unknown }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function getAqiMessage(value: unknown): AqiMessage {
  if (
    !value ||
    typeof value !== 'object' ||
    !('rxs' in value) ||
    !value.rxs ||
    typeof value.rxs !== 'object' ||
    !('obs' in value.rxs) ||
    !Array.isArray(value.rxs.obs)
  ) {
    throw new Error('AQI response has no rxs.obs array');
  }
  const entry = value.rxs.obs.find(
    (item: unknown) =>
      !!item &&
      typeof item === 'object' &&
      'status' in item &&
      item.status === 'ok' &&
      'msg' in item,
  );
  const msg: unknown = entry?.msg;
  if (
    !msg ||
    typeof msg !== 'object' ||
    !('aqi' in msg) ||
    typeof msg.aqi !== 'number' ||
    !Number.isFinite(msg.aqi) ||
    !('idx' in msg) ||
    msg.idx !== 5724 ||
    !('city' in msg) ||
    !msg.city ||
    typeof msg.city !== 'object' ||
    !('name' in msg.city) ||
    msg.city.name !== 'London' ||
    !('xsync' in msg) ||
    !msg.xsync ||
    typeof msg.xsync !== 'object' ||
    !('gen' in msg.xsync) ||
    typeof msg.xsync.gen !== 'number' ||
    !('time' in msg) ||
    !msg.time ||
    typeof msg.time !== 'object' ||
    !('v' in msg.time) ||
    typeof msg.time.v !== 'number'
  ) {
    throw new Error('AQI response has no valid London measurement');
  }
  return msg as AqiMessage;
}
