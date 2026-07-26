# Component Playbooks — Build Instructions per Component Type

> Step-by-step instructions for building each Framer section type as Elementor V3 widgets.
> Use `v4-engine.md` for CSS workarounds and `patterns.md` for the widget-first structure.
> All API calls use Novamira MCP (`novamira/elementor-*` and `novamira-adrianv2/*` abilities).

---

## Hero Section

### Container Structure
```
container.hero-section  (elType:container, isInner:false)
  content_width:full, flex_direction:column, flex_align_items:center
  min_height:100vh, background_color:#0A0A0A
  
  container.hero-copy  (isInner:true)
    content_width:boxed, flex_direction:column, flex_align_items:center
    flex_gap:24px
    
    heading.hero-headline  (widgetType:heading)
      header_size:h1, align:center, title_color:#FFFFFF
      typography_font_family:Inter, typography_font_size:64px
      
    text-editor  (widgetType:text-editor)
      align:center, text_color:#A0A0A0
      
    button.hero-cta  (widgetType:button)
      text:"Get Started", background_color:#FFFFFF, text_color:#0A0A0A
      
  container.hero-video-card  (isInner:true)
    content_width:full, width:560px, border_radius:16px, overflow:hidden
    
    image  (widgetType:image)
      image:{url:"..."}, image_size:full
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `hero-section` | Root container | ScrollTrigger trigger, background |
| `hero-copy` | Inner container | Constrain text width |
| `hero-headline` | Heading widget | GSAP target, typography override |
| `hero-cta` | Button widget | Button style override |
| `hero-video-card` | Inner container | Aspect ratio, shadow |

### GSAP Animation
- Timeline stagger: headline → subtitle → CTA → video card
- Initial state: `opacity:0, translate:'0px 40px'` (atomic, not transform)
- Ease: `power3.out`, ScrollTrigger at `top 80%`

### V4 Gotchas
- Hero on `elementor_canvas` template may need `min-height` in px not vh for pixel-perfect match
- `e-con-boxed > .e-con-inner` selector for the copy container inner wrapper
- Font must be loaded via WPCode Google Fonts link

---

## Stats Bar

### Container Structure
```
container.stats-section  (elType:container, isInner:false)
  content_width:full, flex_direction:row, flex_wrap:wrap
  flex_justify_content:center, flex_align_items:center
  background_color:#FFFFFF, padding:80px 24px
  
  container.stat-item × 3  (isInner:true)
    _element_width:"initial", _element_custom_width:{unit:"px",size:280}
    content_width:full, flex_direction:column, flex_align_items:center
    
    heading.stat-number
      header_size:h2, align:center, typography_font_size:48px
      
    text-editor.stat-label
      align:center, text_color:#666666
  
  html.stat-divider × 2  (between items)
    html:"<div class='stat-divider'></div>"
```

### CRITICAL: V4 Width Fix
The V4 engine forces `width:100%` on `e-con-full` children in row layouts.
Add per-data-id CSS after creating the containers:
```css
body.page-id-X [data-id="childId1"],
body.page-id-X [data-id="childId2"],
body.page-id-X [data-id="childId3"] {
  width: 280px !important;
  flex-shrink: 0;
}
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `stats-section` | Root container | White background, center layout |
| `stat-item` | Child container | Fixed width card |
| `stat-number` | Heading widget | Large serif number |
| `stat-label` | Text editor widget | Small label text |
| `stat-divider` | HTML widget wrapper | Vertical 1px line |

### GSAP Animation
- `gsap.fromTo` with stagger 0.15
- Translate from `0px 30px` to `0px 0px`
- ScrollTrigger at `top 85%`

---

## Manifesto / Text Reveal

### Container Structure
```
container.manifesto-section  (elType:container, isInner:false)
  content_width:full, flex_direction:column
  flex_align_items:center, flex_justify_content:center
  min_height:80vh, background_color:#0A0A0A
  
  heading.manifesto-text  (widgetType:heading)
    header_size:h2, align:center, title_color:#FFFFFF
    typography_font_family:Lora, typography_font_size:42px
    typography_line_height:{unit:"em",size:1.4}
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `manifesto-section` | Root container | Dark bg, center content |
| `manifesto-text` | Heading widget | Max-width constrain, GSAP target |
| `manifesto-word` | Injected span | Word-by-word opacity scrub |

### JS: Word Splitting & Scrub
```js
var heading = document.querySelector('.manifesto-text .elementor-heading-title');
var words = heading.textContent.trim().split(' ').filter(Boolean);
heading.innerHTML = words.map(function(w){ 
  return '<span class="manifesto-word">' + w + '</span>'; 
}).join(' ');

gsap.fromTo('.manifesto-word',
  { opacity: 0.2 },
  { opacity: 1, duration: 0.5, stagger: 0.05,
    scrollTrigger: { trigger: '.manifesto-section', start: 'top 80%', end: 'bottom 40%', scrub: 1 }
  }
);
```

### CRITICAL RULES
- **scrub: 1** — never replace with toggleActions
- **fromTo** — never use from() alone
- **filter(Boolean)** — removes empty strings from split

---

## Orbit Image Ring

### Container Structure
```
container.orbit-section  (elType:container, isInner:false)
  content_width:full, flex_direction:column
  flex_align_items:center, flex_justify_content:center
  min_height:100vh, background_color:#0A0A0A
  
  container.orbit-stage  (isInner:true)
    content_width:full, width:700px, min_height:700px
    
    container.orbit-wrapper  (isInner:true)
      content_width:full
      
      image.orbit-item × 6  (widgetType:image)
        image:{url:"..."}, image_size:thumbnail
        css_classes:"orbit-item"
    
    heading.orbit-title  (widgetType:heading)
      header_size:h2, align:center, title_color:#FFFFFF
      css_classes:"orbit-title"
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `orbit-section` | Root container | Dark bg, overflow hidden |
| `orbit-stage` | Stage container | Position relative, fixed size |
| `orbit-wrapper` | Wrapper container | Inset 0, pointer-events none |
| `orbit-item` | Image widget | Absolute center, translate via JS |
| `orbit-title` | Heading widget | Centered, z-index 20 |

### JS: requestAnimationFrame + style.translate
See `patterns.md` Pattern C for full implementation. Config:
- `DESKTOP_RADIUS = 320`, `MOBILE_RADIUS = 190`
- `DURATION = 28` (seconds per revolution)
- Start angle: `-Math.PI / 2` (12 o'clock position)

### CRITICAL RULES
- **Never** use CSS @keyframes — causes sechseck distortion
- **Never** use gsap.set with transform — V4 overrides it
- **Always** use `item.style.translate = 'Xpx Ypx'` — atomic property

---

## Service Cards

### Container Structure
```
container.service-section  (elType:container, isInner:false)
  content_width:full, flex_direction:row, flex_wrap:wrap
  flex_justify_content:center, flex_gap:24px
  
  container.service-card × N  (isInner:true)
    _element_width:"initial", _element_custom_width:{unit:"px",size:280}
    content_width:full, flex_direction:column
    background_color:#FFFFFF, border_radius:16px, overflow:hidden
    
    image  (widgetType:image)
    
    container.service-meta  (isInner:true)
      content_width:full, padding:20px
      
      heading  (widgetType:heading)
      text-editor  (widgetType:text-editor)
      
  container.center-card  (isInner:true)
    _element_width:"initial", _element_custom_width:{unit:"px",size:280}
    content_width:full, flex_direction:column
    flex_align_items:center, flex_justify_content:center
    background_color:#0A0A0A
    
    heading  (widgetType:heading)
      align:center, title_color:#FFFFFF
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `service-section` | Root container | Background, center layout |
| `service-card` | Child container | Card styling, hover effect |
| `service-meta` | Inner container | Card text padding |
| `center-card` | Child container | Dark "View All" card |

### GSAP Animation
- `gsap.fromTo` stagger 0.12
- Translate from `0px 40px` to `0px 0px`
- ScrollTrigger at `top 80%`

---

## Steps

### Container Structure
```
container.steps-section  (elType:container, isInner:false)
  content_width:full, flex_direction:row, flex_wrap:wrap
  flex_justify_content:center, flex_gap:24px
  
  container.step-card × N  (isInner:true)
    _element_width:"initial", _element_custom_width:{unit:"px",size:340}
    content_width:full, flex_direction:column
    border_radius:16px, overflow:hidden
    
    container.step-media  (isInner:true)
      content_width:full
      
      image  (widgetType:image)
      
    heading.step-number
      css_classes:"step-number"
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `steps-section` | Root container | Section padding, bg |
| `step-card` | Child container | Card background, border |
| `step-media` | Inner container | Image container |
| `step-number` | Heading widget | Absolute position badge |

### GSAP Animation
- Same pattern as service cards: stagger 0.15, translate from 0px 50px

---

## Team Marquee

### Container Structure
```
container.team-marquee  (elType:container, isInner:false)
  content_width:full, overflow:hidden
  background_color:#F5F5F5
  
  container.team-track  (isInner:true)
    content_width:full, flex_direction:row, flex_wrap:nowrap
    flex_gap:24px
    
    container.doctor-card × N  (isInner:true)
      _element_width:"initial", _element_custom_width:{unit:"px",size:280}
      content_width:full, flex_direction:column
      border_radius:16px, overflow:hidden
      background_color:#FFFFFF
      
      image  (widgetType:image)
      
      container.doctor-meta  (isInner:true)
        content_width:full, padding:20px
        
        heading.doctor-name
        text-editor.doctor-role
```

### CSS Animation (NOT JS-driven)
```css
.team-marquee { overflow: hidden; }
.team-track {
  display: flex; gap: 24px; width: max-content;
  animation: marquee-scroll 30s linear infinite;
}
@keyframes marquee-scroll {
  0% { translate: 0px 0px; }
  100% { translate: -50% 0px; }
}
```

### JS: Duplicate Cards
```js
var track = document.querySelector('.team-track');
var children = Array.from(track.children);
children.forEach(function(c){ track.appendChild(c.cloneNode(true)); });
```

### CRITICAL: Use `translate` NOT `transform` in @keyframes
`@keyframes marquee-scroll { to { translate: -50% 0px; } }` — atomic property, immune to V4 override.

---

## FAQ Accordion

### Container Structure
```
container.faq-section  (elType:container, isInner:false)
  content_width:full, flex_direction:column
  flex_align_items:center
  
  accordion.ch-faq-accordion  (widgetType:accordion)
    css_classes:"ch-faq-accordion"
```

### Notes
- Use native Elementor Accordion widget — no custom JS needed
- Style via CSS: borders, padding, active state color
- No GSAP animation (Elementor JS handles toggle)

---

## CTA / Footer

### Container Structure
```
container.cta-footer-section  (elType:container, isInner:false)
  content_width:full, flex_direction:column
  flex_align_items:center
  background_color:#0A0A0A, padding:100px 24px 40px
  
  heading.cta-heading
    header_size:h2, align:center
    title_color:#FFFFFF
    
  button.cta-button
    text:"Get Started", background_color:#FFFFFF, text_color:#0A0A0A
    
  container  (isInner:true, flex row, footer links)
    link × N  (text widgets or buttons with link type)
    
  text-editor.footer-legal
```

### CSS Classes Reference
| Class | Element | Purpose |
|-------|---------|---------|
| `cta-footer-section` | Root container | Dark bg, center layout |
| `cta-heading` | Heading widget | Large white headline |
| `cta-button` | Button widget | White CTA button |
| `footer-link` | Link/button | Subtle footer nav |
| `footer-legal` | Text editor | Small legal text |

### GSAP Animation
- Timeline: heading → button → badges
- Translate from `0px 30px`
