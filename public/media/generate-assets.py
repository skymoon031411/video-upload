"""Generate original, dependency-free MUYING demo illustrations."""
from pathlib import Path
import math
import random

ROOT = Path(__file__).parent
random.seed(3114)

def save(name, sky_top, sky_bottom, content):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
<defs>
<linearGradient id="sky" x2="0" y2="1"><stop stop-color="{sky_top}"/><stop offset="1" stop-color="{sky_bottom}"/></linearGradient>
<linearGradient id="water" x2="0" y2="1"><stop stop-color="#22636d"/><stop offset="1" stop-color="#071923"/></linearGradient>
<linearGradient id="sand" x2="0.5" y2="1"><stop stop-color="#d7ae80"/><stop offset="1" stop-color="#4d3639"/></linearGradient>
<linearGradient id="glass" x2="1" y2="1"><stop stop-color="#405077"/><stop offset="1" stop-color="#161e32"/></linearGradient>
<radialGradient id="glow"><stop stop-color="#fdd2a0" stop-opacity=".75"/><stop offset="1" stop-color="#e3a882" stop-opacity="0"/></radialGradient>
<radialGradient id="blueglow"><stop stop-color="#769ebc" stop-opacity=".48"/><stop offset="1" stop-color="#769ebc" stop-opacity="0"/></radialGradient>
<radialGradient id="vignette"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#020407" stop-opacity=".5"/></radialGradient>
<filter id="blur"><feGaussianBlur stdDeviation="24"/></filter>
<filter id="soft"><feGaussianBlur stdDeviation="4"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".45" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".055"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter>
</defs>
<g filter="url(#grain)"><rect width="1600" height="1000" fill="url(#sky)"/>{content}<rect width="1600" height="1000" fill="url(#vignette)"/></g>
</svg>'''
    (ROOT / f'{name}.svg').write_text(svg)

def city(name, rainy=False):
    pieces = ['<ellipse cx="1170" cy="560" rx="640" ry="390" fill="url(#glow)" opacity=".4"/>', '<ellipse cx="490" cy="490" rx="540" ry="360" fill="url(#blueglow)"/>']
    for depth in range(3):
        x = -50
        while x < 1670:
            w = random.randint(42, 95)
            h = random.randint(90, 350) + depth * 45
            y = 735 - h + depth * 80
            fill = ['#283144', '#171e2e', '#0e1420'][depth]
            pieces.append(f'<rect x="{x}" y="{y}" width="{w}" height="{1000-y}" fill="{fill}"/>')
            if w > 70:
                pieces.append(f'<rect x="{x+w//3}" y="{y-20}" width="{w//3}" height="20" fill="{fill}"/>')
            for wx in range(x + 8, x + w - 5, 12):
                for wy in range(y + 12, min(y + h, 880), 20):
                    if random.random() > .32:
                        col = random.choice(['#d3a769', '#9fb2bb', '#e5b870', '#637888'])
                        pieces.append(f'<rect x="{wx}" y="{wy}" width="4" height="7" fill="{col}" opacity="{random.uniform(.25,.9):.2f}"/>')
            x += w + random.randint(5, 22)
    pieces.append('<path d="M650 1000L925 712H1000L870 1000Z" fill="#d89159" opacity=".22"/><path d="M725 1000L975 722" stroke="#fbd4a0" stroke-width="4" opacity=".7"/><path d="M745 1000L987 722" stroke="#df6343" stroke-width="3" opacity=".8"/>')
    if rainy:
        pieces.append('<rect y="860" width="1600" height="140" fill="#121c30" opacity=".7"/>')
        for _ in range(50):
            x, y = random.randint(0,1600), random.randint(0,1000)
            pieces.append(f'<path d="M{x} {y}l-14 52" stroke="#b0c4d3" opacity=".12" stroke-width="2"/>')
        pieces.append('<path d="M195 1000L440 625" stroke="#ce768b" stroke-width="14" opacity=".35" filter="url(#blur)"/>')
    else:
        pieces.append('<circle cx="1250" cy="154" r="30" fill="#edcfb6" opacity=".8"/>')
    save(name, '#131d33' if not rainy else '#101932', '#6a5360' if not rainy else '#324351', ''.join(pieces))

city('city-night')
city('rain-city', True)

save('coast', '#566c79', '#e3bda2', '''
<ellipse cx="1080" cy="380" rx="440" ry="240" fill="url(#glow)"/><circle cx="1100" cy="385" r="48" fill="#efd4ac" opacity=".9"/>
<rect y="480" width="1600" height="520" fill="url(#water)"/>
<path d="M0 488L420 453L820 495L0 565Z" fill="#46606c"/>
<path d="M0 450Q120 405 245 520Q310 600 385 652L542 745L730 849L603 1000H0Z" fill="#253c3d"/>
<path d="M0 531Q210 483 250 638L443 725L600 825L547 882L0 702Z" fill="#46504b"/>
<path d="M0 521Q220 455 278 641Q382 691 459 733L636 821" fill="none" stroke="#bfa884" stroke-width="12"/>
<path d="M330 632Q518 676 560 735Q650 770 783 803Q823 885 999 945" fill="none" stroke="#d5dad1" opacity=".72" stroke-width="6"/>
<path d="M360 611Q570 653 619 712Q805 735 918 842M617 511L1100 506M886 530L1440 524M1030 577L1570 568" fill="none" stroke="#d4e5df" opacity=".3" stroke-width="3"/>
<path d="M1108 487L1225 986" stroke="#d1ae8d" stroke-width="40" opacity=".22" filter="url(#blur)"/>
''')

save('mountains', '#52687f', '#e5b4a1', '''
<circle cx="1050" cy="310" r="74" fill="#edc1a5"/><ellipse cx="1050" cy="330" rx="430" ry="260" fill="url(#glow)"/>
<path d="M0 637L180 394L302 510L551 281L848 578L1040 390L1220 527L1430 293L1600 460V1000H0Z" fill="#71818d"/>
<path d="M435 420L551 281L670 439L569 396L533 417L510 380Z M1302 457L1430 293L1518 393L1419 353L1401 392L1378 373Z" fill="#e1dad0"/>
<path d="M0 714L292 524L530 671L818 467L1056 655L1318 570L1600 796V1000H0Z" fill="#3e5666"/>
<path d="M0 896Q260 693 460 830Q870 612 1170 827L1600 741V1000H0Z" fill="#19333e"/>
<ellipse cx="860" cy="827" rx="920" ry="87" fill="#c7b6ad" opacity=".25" filter="url(#blur)"/>
<path d="M0 1000L388 858L622 966L936 840L1180 1000Z" fill="#0b232d"/>
''')

save('lake', '#6a838d', '#c7bfb4', '''
<path d="M0 493L250 197L535 473L815 230L1080 470L1370 151L1600 465V650H0Z" fill="#586f73"/>
<path d="M142 325L250 197L384 328L266 290L227 320L214 281Z M690 363L815 230L909 330L814 295L788 327Z M1255 295L1370 151L1490 287L1380 249L1349 263L1323 236Z" fill="#d6d4c8"/>
<path d="M0 506L353 365L513 524L882 439L1086 527L1427 394L1600 530V650H0Z" fill="#284746"/>
<rect y="561" width="1600" height="439" fill="url(#water)"/>
<path d="M0 561L250 855L535 582L815 823L1080 581L1370 901L1600 596V561Z" fill="#708686" opacity=".3"/>
<path d="M0 561Q352 531 628 571T1161 555T1600 561" fill="none" stroke="#91a8a1" stroke-width="4"/>
<path d="M0 924Q157 841 290 865L328 905L524 952L655 1000H0Z" fill="#122927"/>
<path d="M1122 729L1321 729L1300 745H1143Z" fill="#d7b68c"/><path d="M1217 728L1217 637L1253 719Z" fill="#ebe4d8" opacity=".75"/>
''')

save('open-road', '#7c9298', '#f1ce9b', '''
<circle cx="1130" cy="347" r="52" fill="#efd4a5"/>
<path d="M0 580Q278 386 586 555Q806 347 1123 544Q1401 421 1600 495V1000H0Z" fill="#78774e"/>
<path d="M0 653Q356 509 700 716Q1209 416 1600 677V1000H0Z" fill="#ac9261"/>
<path d="M0 760Q371 623 881 796Q1370 636 1600 828V1000H0Z" fill="#726d47"/>
<path d="M566 1000Q763 857 753 786Q736 705 1010 632Q1146 594 1114 558" fill="none" stroke="#a5a092" stroke-width="75"/>
<path d="M571 1000Q767 857 756 786Q739 705 1010 632Q1146 594 1114 558" fill="none" stroke="#ded2b3" stroke-width="4" stroke-dasharray="24 34"/>
<path d="M0 863Q232 741 396 927L370 1000H0Z" fill="#2e453c"/>
<path d="M1182 1000Q1374 821 1600 882V1000Z" fill="#39493b"/>
''')

def trees(seed, count, color, y, max_h):
    rng=random.Random(seed)
    bits=[]
    for _ in range(count):
        x=rng.randint(-80,1680); h=rng.randint(120,max_h); w=h*rng.uniform(.23,.43)
        bits.append(f'<path d="M{x} {y-h}L{x-w} {y-35}L{x+w} {y-35}Z" fill="{color}"/><rect x="{x-5}" y="{y-50}" width="10" height="75" fill="{color}"/>')
    return ''.join(bits)

save('forest', '#465e5a', '#bdbe95', '<ellipse cx="970" cy="300" rx="500" ry="480" fill="url(#glow)"/>'+trees(1,23,'#748675',745,570)+trees(2,19,'#375c51',850,610)+'''<path d="M880 0L364 1000H650L1120 0Z" fill="#e7d6a7" opacity=".1"/><path d="M1010 0L851 1000H923L1150 0Z" fill="#e7d6a7" opacity=".1"/>'''+trees(5,12,'#163c34',1050,790)+'<path d="M0 987Q527 845 803 992Q1264 839 1600 933V1000H0Z" fill="#0b2822"/>')

save('quiet-room', '#584335', '#1e211f', '''
<rect x="912" y="100" width="484" height="662" fill="#c3b799"/><rect x="926" y="116" width="456" height="620" fill="#8caca3"/>
<path d="M926 610L1110 468L1262 566L1382 455V736H926Z" fill="#527a70"/>
<rect x="1148" y="105" width="16" height="644" fill="#37352d"/><rect x="912" y="438" width="484" height="14" fill="#37352d"/>
<path d="M915 741L240 1000H996L1400 741Z" fill="#d1b88b" opacity=".14"/>
<rect x="74" y="714" width="845" height="60" rx="5" fill="#91765a"/><rect x="105" y="774" width="35" height="226" fill="#312d26"/>
<ellipse cx="587" cy="708" rx="85" ry="19" fill="#b3a389"/><path d="M539 643H632L620 710H551Z" fill="#d6c8b0"/><path d="M632 655Q683 651 673 680Q665 696 626 687" fill="none" stroke="#d6c8b0" stroke-width="11"/>
<ellipse cx="585" cy="644" rx="46" ry="9" fill="#352820"/>
<path d="M320 706L425 706L411 609L337 609Z" fill="#79644f"/><path d="M371 608L380 444M372 553Q293 532 297 471Q370 467 376 526M376 513Q442 477 464 415Q371 419 379 485" fill="#27473b" stroke="#284538" stroke-width="5"/>
<rect x="215" y="690" width="173" height="15" fill="#9a8b6c"/><rect x="202" y="674" width="162" height="14" fill="#544c42"/>
<ellipse cx="1220" cy="410" rx="350" ry="360" fill="url(#glow)" opacity=".27"/>
''')

save('light-study', '#16212e', '#9d7261', '''
<ellipse cx="1050" cy="440" rx="600" ry="390" fill="url(#glow)"/>
<circle cx="1010" cy="408" r="158" fill="#e6b18c" opacity=".9"/>
<path d="M0 667Q393 366 728 733Q1218 557 1600 674V1000H0Z" fill="#6a625b"/>
<path d="M0 797Q676 576 892 1000H0Z" fill="url(#sand)"/>
<path d="M1600 741Q1040 747 857 1000H1600Z" fill="#332e37"/>
<path d="M0 797Q490 622 679 839" fill="none" stroke="#dbb393" stroke-width="3" opacity=".65"/>
<ellipse cx="967" cy="843" rx="109" ry="17" fill="#1c202a" opacity=".4"/>
<rect x="932" y="631" width="41" height="212" fill="#222b35"/><path d="M973 631L991 646V843H973Z" fill="#463945"/>
''')

print('Generated 9 original SVG illustrations.')
