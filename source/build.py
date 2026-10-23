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
  <footer class="foot">
    <p>Stand keeps your scores, markings, recordings and practice log on your device and works offline. Coming to the App Store, for iPadOS and iOS 15 or later. Example scores by J. S. Bach: Minuet in G (BWV Anh. 114) and the Pr&eacute;lude of the Cello Suite No. 1 (BWV 1007). Music font: Bravura (SIL Open Font License).</p>
    <nav aria-label="More"><a href="privacy.html">Privacy policy</a><span>&copy; 2026 Stand</span></nav>
  </footer>
</div>
<section class="sheet" id="sheet" hidden aria-modal="true" role="dialog" aria-labelledby="sheetTitle">
  <div class="bar">
    <span class="t"><span id="barTitle"></span><span class="ch-name" id="barCh"></span></span>
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
{core}
</script>
'''
syms=R('syms.svg')
for name,title,fonts,css,js,top in [
 ('v1_paper.html','Stand Site, Paper Folders','https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap','paper.css','paper.js','<b>Stand</b><span class="mono">For iPad and iPhone · v2.9</span>'),
 ('v2_app.html','Stand Site, App Folders','https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400..700&display=swap','app.css','app.js','<b>Stand</b><span>For iPad and iPhone</span>')]:
    out=SHELL.format(title=title,fonts=fonts,css=R('core.css')+'\n'+R(css),syms=syms,top=top,content=R('content.js'),theme=R(js),core=R('core.js'))
    open(os.path.join(D,'..',name),'w').write(out); print(name,len(out))
