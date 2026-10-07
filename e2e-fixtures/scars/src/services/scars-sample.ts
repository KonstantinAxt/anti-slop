export async function fetchUserData() {
  const res = await fetch("/api/user");
  const data = (await res.json()) as { id: string };
  return data;
}

export function swallowError() {
  try {
    JSON.parse("invalid");
  } catch (_e) {}
}

export const wrapUser = (id: string, name: string) => ({ id, name });

export function processList(items: string[]) {
  items.forEach(async (item) => {
    await fetch(`/sync/${item}`);
  });

  return items.filter(async (item) => item.length > 0);
}
