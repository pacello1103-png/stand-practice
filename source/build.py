import os
D=os.path.dirname(os.path.abspath(__file__)); R=lambda f: open(os.path.join(D,f)).read()
SHELL='''<meta charset="utf-8">
<title>{title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Stand is a music stand, practice room and writing desk for iPad and iPhone.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{fonts}">
<style>
{css}
</style>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
{syms}
<symbol id="i-chev-l" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-chev-r" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
</svg>
<div class="wrap">
  <header class="top">{top}</header>
  <main class="drawer" id="drawer" aria-label="What Stand does"></main>
  <section class="also" id="also" aria-label="Also in Stand"></section>
  <div class="more" id="more"></div>
  <footer class="foot">
    <p>Stand keeps your scores, markings, recordings and practice log on your device and works offline. For iPad and iPhone, iPadOS and iOS 15 or later. The scores on this page are J. S. Bach: the Minuet in G (BWV Anh. 114), arranged for cello, and the Pr&eacute;lude of the Cello Suite No. 1 (BWV 1007), engraved from public-domain editions (Bach-Gesellschaft; Schirmer, 1916) transcribed by the Mutopia Project. Music font: Bravura (SIL Open Font License).</p>
    <nav aria-label="More"><a href="privacy.html">Privacy policy</a><a href="terms.html">Terms of use</a><a href="privacy.html#support">Support</a><span>&copy; 2026 Stand</span></nav>
  </footer>
</div>
<section class="sheet" id="sheet" hidden aria-modal="true" role="dialog" aria-labelledby="sheetTitle">
  <div class="bar">
    <span class="t"><span id="barTitle"></span><span class="ch-name" id="barCh"></span></span>
    <span class="barcta" id="barCta"></span>
    <button class="icon" id="prevBtn" aria-label="Previous folder"><svg><use href="#i-chev-l"/></svg></button>
    <button class="icon" id="nextBtn" aria-label="Next folder"><svg><use href="#i-chev-r"/></svg></button>
    <button class="icon" id="closeBtn" aria-label="Close"><svg><use href="#i-x"/></svg></button>
    <div class="progress"></div>
  </div>
  <div class="sbody" id="sheetBody"></div>
</section>
<script>
{content}
{theme}
document.getElementById('also').innerHTML = ALSO.map(([i, t]) => `<span><svg class="i" aria-hidden="true"><use href="#i-${{i}}"/></svg>${{t}}</span>`).join('');
{home}
{core}
</script>
'''
syms=R('syms.svg')
SITE='https://pacello1103-png.github.io/stand-practice/'
HEAD='''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Stand · The music stand that practises with you</title>
<meta name="theme-color" content="#7c7666" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#262420" media="(prefers-color-scheme: dark)">
<meta name="format-detection" content="telephone=no">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Stand">
<meta property="og:title" content="Stand · The music stand that practises with you">
<meta property="og:description" content="Read and mark your scores, turn pages hands-free, tune, practise, record yourself and write music. For iPad and iPhone.">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{og}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{url}">
<link rel="icon" href="{site}icon.png">
<link rel="apple-touch-icon" href="{site}icon.png">
</head>
<body>
'''
for name,title,fonts,css,js,top in [
 ('v1_paper.html','Stand Site, Paper Folders','https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap','paper.css','paper.js','<b>Stand</b><span class="mono">For iPad and iPhone</span>')
]:  # the App Folders look (/app/) is no longer built; it keeps its last version
    out=SHELL.format(title=title,fonts=fonts,css=R('core.css')+'\n'+R(css),syms=syms,top=top,content=R('content.js'),theme=R(js),home=(R('home.js') if js=='paper.js' else ''),core=R('core.js'))
    open(os.path.join(D,'..',name),'w').write(out); print(name,len(out))
    # the published pages: the same body with share-preview tags around it
    sub = name.startswith('v2')
    rest = out.split('\n',2)[2]  # drop the charset and draft title lines
    headx, body = rest.split('</style>\n', 1); headx += '</style>\n'
    if sub:  # /app/ lives one folder down
        headx = headx
        body = body.replace('href="privacy.html', 'href="../privacy.html').replace('href="terms.html', 'href="../terms.html').replace('src="img/', 'src="../img/').replace("`img/m_", "`../img/m_")
    page = HEAD.format(url=SITE + ('app/' if sub else ''), og=SITE + ('og-app.jpg' if sub else 'og.jpg'), site=SITE).replace('</head>', headx + '</head>') + body + '\n</body>\n</html>\n'
    dest = os.path.join(D, '..', 'app', 'index.html') if sub else os.path.join(D, '..', 'index.html')
    open(dest, 'w').write(page); print(dest, len(page))
