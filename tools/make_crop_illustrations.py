"""Original SVG crop illustrations, not imagery or evidence about a farm."""
from pathlib import Path

root=Path(__file__).resolve().parents[1]/'website/static/website/crops'
root.mkdir(exist_ok=True)
leaf='<path d="M100 130C58 121 55 76 65 57c35 13 48 42 35 73" fill="#70a95a"/><path d="M99 130c3-47 29-70 61-77-1 45-24 71-61 77" fill="#398153"/>'
shapes={
'rice':'<path d="M89 174c7-70 29-102 65-126M89 174c-9-49-28-66-49-75" fill="none" stroke="#4d8041" stroke-width="7"/>'+''.join(f'<ellipse cx="{x}" cy="{y}" rx="9" ry="16" transform="rotate(42 {x} {y})" fill="#e9bc4e"/>' for x,y in [(149,57),(133,72),(121,91),(110,111),(99,131),(55,104),(70,121)]),
'maize':'<path d="M70 170c-45-28-42-70-30-98 32 14 49 44 40 74M126 168c48-20 56-57 44-89-38 8-55 36-54 66" fill="#579044"/><ellipse cx="100" cy="103" rx="30" ry="67" fill="#e9bd42"/>'+''.join(f'<ellipse cx="{x}" cy="{y}" rx="5" ry="7" fill="#fbe088"/>' for x in (84,100,116) for y in (62,80,98,116,134,152)),
'cassava':leaf+'<path d="M85 130c-33 7-53 23-55 42 10 15 45 5 69-27M100 127c-16 27-17 53-3 64 19 2 31-32 20-62M115 127c34 0 56 11 62 32-8 17-39 10-66-10" fill="#986747" stroke="#6a4933" stroke-width="4"/><ellipse cx="169" cy="159" rx="11" ry="13" fill="#eee4c9"/>',
'arabica-coffee':leaf+'<ellipse cx="79" cy="143" rx="24" ry="31" transform="rotate(30 79 143)" fill="#905b3f"/><path d="M87 115c-22 21 5 33-16 53" fill="none" stroke="#e8c9a7" stroke-width="5"/><circle cx="135" cy="153" r="21" fill="#c5533e"/>',
'robusta-coffee':leaf+'<ellipse cx="82" cy="145" rx="27" ry="29" fill="#6c4939"/><path d="M81 117c-13 20 14 34 1 55" fill="none" stroke="#d7b58e" stroke-width="5"/><circle cx="137" cy="147" r="23" fill="#a84135"/>',
'banana':'<path d="M85 56l17-24 15 11-16 27" fill="#548341"/>'+''.join(f'<path d="M{a} 67c-12 48 12 80 58 68 11-3 15-11 11-17-36 7-55-7-49-44Z" transform="rotate({r} 100 100)" fill="{c}" stroke="#d2a83a" stroke-width="3"/>' for a,r,c in [(76,-25,'#f5d66d'),(82,0,'#f8de79'),(90,27,'#eec757')]),
'peanut':'<path d="M64 159c-25-5-30-31-15-48 10-12 11-29 24-39 20-13 44 1 43 22-1 14-15 26-17 39-2 23-16 32-35 26Z" fill="#d1a169" stroke="#a57647" stroke-width="5"/>'+''.join(f'<path d="M{x} {y}l24 14m-18-24-9 23" stroke="#b0834e" stroke-width="2"/>' for x,y in [(58,117),(72,89),(63,140)])+'<ellipse cx="145" cy="133" rx="19" ry="30" fill="#b66f4d"/>',
'soybean':leaf+'<path d="M62 139c18-35 45-47 73-39 17 5 13 37-12 55-29 22-50 17-61-16" fill="#9dab5a"/>'+''.join(f'<circle cx="{x}" cy="{y}" r="14" fill="#e1ca84"/>' for x,y in [(84,141),(107,128),(130,117)]),
'mung-bean':leaf+''.join(f'<ellipse cx="{x}" cy="{y}" rx="18" ry="14" transform="rotate({r} {x} {y})" fill="{c}" stroke="#466d32" stroke-width="2"/><path d="M{x-7} {y}h9" stroke="#e5dfb0" stroke-width="4"/>' for x,y,r,c in [(65,146,-25,'#789344'),(104,158,15,'#66863d'),(139,136,-35,'#8f9e4e'),(105,123,40,'#7d994e')]),
'tomato':'<circle cx="100" cy="113" r="59" fill="#d75b43"/><ellipse cx="79" cy="96" rx="13" ry="22" transform="rotate(25 79 96)" fill="#ef8d6b"/><path d="M100 78l-29-21 25 4 7-28 9 25 28-5-25 24-15-7Z" fill="#3f8051"/>',
'cabbage':'<circle cx="100" cy="113" r="68" fill="#5d9657"/><path d="M100 175c-52-15-72-69-43-104 23-25 42-22 43-4 7-34 42-31 60-1 23 40 1 90-60 109Z" fill="#8bb369"/>'+''.join(f'<path d="M100 172C{x} 133 {x} 90 100 60M100 171c4-38 22-62 47-80" fill="none" stroke="#d2dca0" stroke-width="4"/>' for x in (45,70,88)),
'cucumber':'<path d="M52 145c-15-20 13-67 43-88 20-15 47-7 55 10 12 22-10 67-46 90-21 13-40 6-52-12Z" fill="#468251" stroke="#2e6242" stroke-width="5"/>'+''.join(f'<circle cx="{x}" cy="{y}" r="3" fill="#9eb76c"/>' for x,y in [(73,131),(88,105),(105,80),(104,131),(123,104)])+'<ellipse cx="146" cy="152" rx="25" ry="22" fill="#cedfb1" stroke="#478052" stroke-width="6"/><ellipse cx="146" cy="152" rx="9" ry="11" fill="#eee8bf"/>',
'chilli':'<path d="M63 80c30-10 64-2 62 30-1 24-29 44-66 48-18 3-29 4-31 0 40-11 44-23 44-34-1-14-22-27-9-44Z" fill="#d2513d"/><path d="M63 79l6-15 17 6c16-17 26-22 35-18" fill="none" stroke="#387949" stroke-width="9" stroke-linecap="round"/><path d="M80 96c16 0 26 9 22 24" fill="none" stroke="#ed9678" stroke-width="6" stroke-linecap="round"/>',
}
for name,shape in shapes.items():
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img"><title>{name.replace("-"," ")} crop illustration</title><rect width="200" height="200" rx="24" fill="#eef3e3"/><circle cx="100" cy="100" r="85" fill="#e1ebcf"/>{shape}</svg>'
    (root/(name+'.svg')).write_text(svg,encoding='utf8')
print(f'Wrote {len(shapes)} crop-specific SVG illustrations.')
