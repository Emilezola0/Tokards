import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { db } from "./firebase";
import { loadContent } from "./data/overrides";
import "./styles.css";

// Les modifications de l'Atelier (cartes, decks, images, sons) sont lues avant d'afficher le site.
// Au plus 2,5 s d'attente : au-delà, le site démarre avec le contenu d'origine.
const ready = Promise.race([loadContent(db), new Promise((r) => setTimeout(r, 2500))]);

void ready.then(() =>
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
