# Vendored third-party libraries

## jspdf.umd.min.js
- **jsPDF 2.5.1**, MIT licence, © 2010–2021 James Hall and contributors.
- Source: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`
- sha256: `98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875`
- Vendored so the hosted demo makes **zero** external requests. The demo builds
  a PDF in memory so a reviewer can see the record a submission would produce;
  nothing is uploaded and nothing leaves the page.
- To update: download the pinned version, replace this file, update the hash,
  and re-run `node tools/build-demo-site.mjs`.
