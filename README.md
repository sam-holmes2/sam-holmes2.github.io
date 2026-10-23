# Samuel’s Manuals

Sam Holmes’s personal website: projects, writing, interests and the ideas behind them.

**Visit [samuelsmanuals.com](https://samuelsmanuals.com/).**

## Local preview

This is a static HTML, CSS and JavaScript site. No package installation or build step is required.

From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open [localhost:8000](http://localhost:8000/).

## Structure

- `index.html`: content and page structure.
- `styles.css`: layout, typography and appearance.
- `site.js`: navigation, galleries and carousel controls.
- `assets/`: site images, icons and sharing artwork.

## Deployment

GitHub Pages serves the repository root on the `main` branch. Changes pushed there update the live site. `CNAME` retains the custom domain, and `.nojekyll` keeps deployment static.

Review changes locally before publishing, including narrow layouts, keyboard navigation, image galleries and the Pause carousels control. Use only approved public-safe images and examples. This repository hosts the portfolio; the featured apps have separate release processes.
