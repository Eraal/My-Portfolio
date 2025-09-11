# Eraal Portfolio

A responsive personal portfolio website for Eraal, a Computer Studies student. Built with semantic HTML, Tailwind CSS (CDN), and minimal vanilla JavaScript. Design emphasizes clarity, professionalism, and approachability.

## Features
- Hero section with headline, tagline, and CTAs
- About section with academic focus and skills
- CV section (education, experience, skills, print-ready layout)
- Certifications grid
- Projects grid with tags and links
- Contact form (demo only) + social links
- Accessible, mobile-first, smooth scrolling, subtle animations
- Print-friendly resume extraction

## Structure
```
index.html
assets/
  css/custom.css
  js/main.js
  img/ (placeholder for future images)
```

## Customization
1. Replace placeholder names (University Name, School Name, username, email) in `index.html`.
2. Add real certification details and links.
3. Add real project links (demo + repo).
4. Replace avatar letter with an image (update markup in Hero card).
5. Provide a real `assets/raal-cv.pdf` file for the download link.
6. Integrate a form backend (Formspree, EmailJS, custom API) replacing the alert in `main.js`.

## Printing the CV
Use the Print button in the CV section or browser print (only CV content will appear).

## Deployment
You can deploy easily via:
- GitHub Pages: push and enable Pages
- Vercel / Netlify: one-click deploy static site

## Development
Just open `index.html` in a modern browser. Tailwind uses CDN build for simplicity.

## License
MIT
