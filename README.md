# Thai Mythidex

A small GitHub Pages-friendly Pokédex-style app for Thai mythical and legendary characters.

## How it works

- `index.html`, `styles.css`, and `app.js` make a static frontend.
- `data/creatures.csv` stores the lore entries.
- `assets/creatures/*.png` stores the creature artwork used by each card.

Because it is static, it can run directly on GitHub Pages without Streamlit, Python, or a build step.

## Run locally

Use any tiny static server from the repo root:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish on GitHub Pages

1. Push these files to the `main` branch of `andrewliew86/Thai-mythical-creatures-pokedex`.
2. In GitHub, open **Settings > Pages**.
3. Set **Source** to `Deploy from a branch`.
4. Choose `main` and `/root`.
5. Save and wait for the Pages URL to appear.

## Add a new creature

1. Add a new row to `data/creatures.csv`.
2. Put a matching PNG in `assets/creatures`.
3. Set the row's `image` value to that file path, for example `assets/creatures/new-legend.png`.

Keep commas inside quotes in the CSV, like `"Songkhla, Pattani, and sea routes"`.
