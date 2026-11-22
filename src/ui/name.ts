import { TEST_SLOT } from "../firebase";

const KEY = `tokards.name${TEST_SLOT ? `.${TEST_SLOT}` : ""}`;

export const getName = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

export const saveName = (name: string) => {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* stockage indisponible : le pseudo ne sera pas mémorisé */
  }
};

/** Derniers salons ouverts (le plus récent d'abord), pour y revenir depuis l'accueil. */
const ROOMS = `tokards.rooms${TEST_SLOT ? `.${TEST_SLOT}` : ""}`;
export type RecentRoom = { code: string; at: number };
export const getRecentRooms = (): RecentRoom[] => {
  try {
    const v = JSON.parse(localStorage.getItem(ROOMS) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => typeof r?.code === "string") : [];
  } catch {
    return [];
  }
};
export const rememberRoom = (code: string) => {
  try {
    const cur = getRecentRooms();
    if (cur[0]?.code === code && Date.now() - cur[0].at < 60000) return; // appelé à chaque rendu : pas d'écriture inutile
    const list = [{ code, at: Date.now() }, ...getRecentRooms().filter((r) => r.code !== code)].slice(0, 5);
    localStorage.setItem(ROOMS, JSON.stringify(list));
  } catch {
    /* stockage indisponible */
  }
};
export const forgetRoom = (code: string) => {
  try {
    localStorage.setItem(ROOMS, JSON.stringify(getRecentRooms().filter((r) => r.code !== code)));
  } catch {
    /* stockage indisponible */
  }
};
/** Code de salon extrait d'un texte collé : code seul ou lien complet (…#/ABCDE). */
export const codeFrom = (s: string) => {
  const hash = s.includes("#") ? s.slice(s.lastIndexOf("#") + 1) : s;
  return hash.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
};
