# Draws docs/band.svg and docs/board.svg for the README. Run: python3 scripts/board_svg.py docs
import sys
from xml.sax.saxutils import escape
C = {'fg':'#e6e4df','dim':'#8a877f','claude':'#d77757','warning':'#e8b04b','success':'#4eba65','bg':'#16161a','edge':'#2c2c32'}
CW, LH, PADX, PADY = 8.4, 20, 20, 24

def bar(s,t,w):
    f=round(min(1,s/t)*w); return '█'*f+'░'*(w-f)

def svg(lines, path, title):
    # lines: list of lists of (col, text, color, bold)
    width = int(PADX*2 + CW*max((c+len(t)) for l in lines for c,t,_,_ in l or [(0,'',0,0)]))
    height = int(PADY*2 + LH*len(lines) + 24)
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
         f'<rect width="{width}" height="{height}" rx="10" fill="{C["bg"]}" stroke="{C["edge"]}"/>',
         '<circle cx="18" cy="14" r="4.5" fill="#ff5f57"/><circle cx="32" cy="14" r="4.5" fill="#febc2e"/><circle cx="46" cy="14" r="4.5" fill="#28c840"/>',
         f'<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" xml:space="preserve">']
    for i,l in enumerate(lines):
        y = PADY + 24 + i*LH
        for col,text,color,bold in l:
            # Place every character on its column so wide fallback glyphs never shift the rest.
            for j,ch in enumerate(text):
                if ch==' ': continue
                x = PADX + (col+j)*CW
                w = ' font-weight="700"' if bold else ''
                out.append(f'<text x="{x:.1f}" y="{y}" fill="{C[color]}"{w}>{escape(ch)}</text>')
    out.append('</g></svg>')
    open(path,'w').write('\n'.join(out))

def seq(*parts, start=0):
    col=start; res=[]
    for text,color,bold in parts:
        res.append((col,text,color,bold)); col+=len(text)
    return res

band=[
 seq(('◆','claude',0),(' ','fg',0),('login-fix','fg',1),(' Review         ','fg',0),(bar(3,4,8),'claude',0),(' 3/4  ','fg',0),('waiting: approve the fix before merge','dim',0)),
 seq(('●','warning',0),(' ','fg',0),('threads  ','fg',1),(' Build          ','fg',0),(bar(6,8,8),'claude',0),(' 6/8  ','fg',0),('staff-engineer 18m 40s','fg',0)),
 seq(('1 other agent running  · /board','dim',0)),
]
D=32
def agent(mark,mc,typ,time,desc,tool=''):
    parts=[(mark,mc,0),(' '+typ.ljust(19)+time.ljust(8),'fg',0)]
    if tool: parts.append((tool+' · ','dim',0))
    parts.append((desc,'fg',0))
    return parts
def note(who,text): return [('○ '+who.ljust(19)+'-'.ljust(8)+text,'dim',0)]
side=[
 [('Loops','fg',1)],
 [('◆','claude',0),(' login-fix','fg',0),(' 3/4','dim',0)],
 [('●','warning',0),(' ','fg',0),('threads','fg',1),(' 6/8','dim',0)],
 [('Other agents','fg',0),(' 1','dim',0)],
 [('Show done (5)','dim',0)],
 [('◆ waiting on you  ● running  ✓','dim',0)],
 [('done','dim',0)],
]
detail=[
 [('threads: Chat: threads and emoji','fg',1)],
 [('● running','warning',0),('   ','fg',0),(bar(6,8,20),'claude',0),(' 6/8 Build','fg',0)],
 [('✓ Brief → ✓ Approve brief → ✓ Design → ✓ Approve design → ✓ Plan → [Build] →','dim',0)],
 [('Review → PR','dim',0)],
 [('Next:','fg',1),(' PR 1 merged and live; staff engineer building PR 2 (threads)','fg',0)],
 [],
 [('Agents','fg',1)],
 agent('✓','success','product-manager','1m 42s','Write the brief'),
 agent('✓','success','designer','10m 15s','Design the mockups'),
 agent('✓','success','general-purpose','7m 58s','Write the build plan'),
 agent('✓','success','staff-reviewer','4m 34s','Review the plan'),
 agent('✓','success','staff-engineer','26m 14s','Build PR 1 reactions'),
 agent('●','warning','staff-engineer','18m 40s','Build PR 2 threads','Bash'),
 note('you','Brief and mockup approved, all recommendations'),
 note('planner','Plan written: PR 1 reactions, PR 2 threads; 2 migrat…'),
 note('code-review-bot','Approved PR 1 (#35)'),
 [],
 [('Links','fg',1)],
 [('Brief: ','fg',0),('docs/briefs/chat-threads.md','claude',0)],
 [('Mockup: ','fg',0),('docs/mockups/chat-threads.html','claude',0)],
 [('Plan: ','fg',0),('docs/plans/chat-threads.md','claude',0)],
 [('PR 1: ','fg',0),('https://github.com/you/your-app/pull/35','claude',0)],
]
pane=[]
for i in range(max(len(side),len(detail))):
    l=seq(*side[i]) if i<len(side) else []
    if i<len(detail) and detail[i]: l+=seq(*detail[i],start=D)
    pane.append(l)
out=sys.argv[1]
svg(band, out+'/band.svg', 'The agent board above the prompt')
svg(pane, out+'/board.svg', 'The /board view with the threads work open')
