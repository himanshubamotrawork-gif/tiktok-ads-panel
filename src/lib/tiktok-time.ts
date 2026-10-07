// TikTok schedule times are UTC strings, "YYYY-MM-DD HH:MM:SS". Browser date-time inputs
// use the viewer's local time, "YYYY-MM-DDTHH:MM". These convert between the two.

const pad = (n: number) => String(n).padStart(2, "0");

/** Local date-time input value -> TikTok UTC time. Returns "" when the value is not a date. */
export function localInputToTikTokTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** TikTok UTC time -> local date-time input value. Returns "" when there is no usable time. */
export function tikTokTimeToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(`${value.trim().replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return dateToLocalInput(date);
}

export function dateToLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
