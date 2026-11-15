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
