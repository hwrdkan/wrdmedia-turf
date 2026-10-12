// Turf Visualizer prompt builder: turns a catalog line, an area choice and an
// optional putting-green preset into one image-edit instruction. Pure, no DOM,
// shared by the browser (window.TurfPrompt), the render function and the tests.
// Lessons carried over from the ARS rubber visualizer: tell the model the sample
// is a macro close-up, define scale and distance falloff explicitly, and list
// everything that must not change.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TurfPrompt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const AREAS = {
    lawn: { label: "The whole lawn", target: "every area of living grass, bare dirt or patchy lawn visible in the photo" },
    backyard: { label: "Backyard lawn", target: "the backyard lawn area (living grass, bare dirt or patchy lawn)" },
    front: { label: "Front yard", target: "the front yard lawn area between the house, driveway, walkway and street" },
    dogrun: { label: "Dog run / side yard", target: "the side yard or dog-run strip of dirt, gravel or grass" },
    dirt: { label: "Dirt or gravel area", target: "the bare dirt, decomposed granite or loose gravel area the homeowner wants covered" },
  };

  // Putting-green designs, ordered by how common they are in residential installs (installer and golf-turf sites,
  // checked 4 Oct 2026): kidney or bean first, then free-form, oval, L-shape, ribbon for side yards, figure-eight.
  // `sqft` is the Medium size and what the planner prices; Small and Large scale it. Typical home greens run 150 to 450
  // sq ft. `aspect` is length over width of the bounding box and `fill` how much of that box the shape covers.
  // Cups follow installer guidance: about 2 on a very small green, 3 up to 250 sq ft, 4 up to 400, 5 above.
  // Collars are 2 to 3 feet wide. `desc` follows the homeowner's choices word for word.
  const SIZES = { s: { label: "Small", k: 0.6, w: 0.2 }, m: { label: "Medium", k: 1, w: 0.3 }, l: { label: "Large", k: 1.5, w: 0.42 }, x: { label: "Fill the space", k: 2, w: 0.62, fill: true } };
  const PRESETS = {
    none: { label: "No putting green", sqft: 0 },
    kidney: { label: "Kidney", note: "Most popular", sqft: 300, aspect: 1.9, fill: 0.78, desc: "a kidney-shaped (bean-shaped) putting green with smooth flowing curved edges and one gentle indent along one side" },
    freeform: { label: "Free-form", note: "Natural curves", sqft: 300, aspect: 1.7, fill: 0.72, desc: "a free-form putting green with flowing, irregular wavy edges, no straight sides, and a few soft bays and points like a natural golf green" },
    oval: { label: "Oval", note: "Simple", sqft: 250, aspect: 1.35, fill: 0.78, desc: "a simple oval putting green with smooth, continuous edges" },
    ell: { label: "L-shape", note: "Wraps a corner", sqft: 300, aspect: 1.5, fill: 0.58, desc: "an L-shaped putting green: two straight arms of equal width joined at a right angle, shaped exactly like the capital letter L lying flat on the ground, each arm about 8 feet wide, with only the corners softly rounded; the two arms run along two adjacent sides of the open turf area and the inside corner of the L is clearly visible" },
    ribbon: { label: "Ribbon", note: "Side yards", sqft: 200, aspect: 2.2, fill: 0.74, desc: "a gently curving ribbon-shaped putting green with soft wavy edges, wide enough to putt on comfortably (a little over twice as long as it is wide, not a thin strip), running along the length of the space" },
    lobes: { label: "Figure-eight", note: "Two zones", sqft: 350, aspect: 1.7, fill: 0.8, desc: "a smooth, flowing figure-eight putting green: two softly rounded lobes of slightly different sizes joined by a wide, gently curved waist, with long blended curves and no sharp pinch, so it looks like a natural free-form green and not a peanut or a dumbbell" },
  };

  // Borders between a green and the ground around it (industry practice: metal edging is the standard recommendation;
  // pavers, rock beds and concrete curbs are the visible options; a flush buried edge is the natural look).
  const BORDERS = {
    auto: { label: "Match my yard", note: "We choose", desc: "the border that best suits the existing ground around the green, chosen from what the photo shows: a thin dark edging strip flush with the surface where the green meets lawn; a clean flush natural edge where it sits in bare dirt or loose gravel; a narrow ring of matching decorative rock where it sits in a rock or gravel bed; and no extra border where it butts directly against pavers, a patio, a wall or a fence" },
    metal: { label: "Edging strip", note: "Bender board or metal", desc: "a thin dark edging strip about half an inch wide (bender board or metal), set flush with the surface and following the green's whole outline, so it reads as one clean thin line" },
    paver: { label: "Paver band", note: "Decorative", desc: "a band of brick-style or travertine pavers about 12 inches wide laid flat and following the green's whole outline, in a color that suits the house and existing hardscape" },
    rock: { label: "Rock border", note: "Natural", desc: "a ring about 2 feet wide of decorative rock (dark lava rock or river rock) laid around the green's whole outline, separating it from the rest of the yard, with a crisp inner edge against the turf" },
    curb: { label: "Concrete curb", note: "Permanent", desc: "a low concrete curb about 4 inches wide, set flush with the ground in a light tan or gray, following the green's whole outline with smooth curves" },
    none: { label: "No border", note: "Flush", desc: "no visible border: the green's edge is tucked flush into the surrounding ground, with a crisp clean line where the turf meets the existing ground" },
  };

  function cupsFor(sqft) { return sqft <= 120 ? 2 : sqft <= 250 ? 3 : sqft <= 400 ? 4 : 5; }

  // Footprint of a chosen design: square feet, rough dimensions in feet, cups, and its width as a share of the photo.
  function footprint(preset, size) {
    const p = PRESETS[preset], s = SIZES[size] || SIZES.m;
    if (!p || !p.sqft) return null;
    const sqft = Math.round((p.sqft * s.k) / 5) * 5;
    const w = Math.sqrt(sqft / (p.aspect * p.fill)), len = w * p.aspect;
    return { sqft, widthFt: Math.round(w), lengthFt: Math.round(len), cups: cupsFor(sqft), frame: s.w, label: s.label };
  }

  function fmtPile(inches) {
    const n = Number(inches);
    if (!Number.isFinite(n) || n <= 0) return null;
    const whole = Math.floor(n), frac = n - whole;
    const eighths = Math.round(frac * 8);
    const f = { 0: "", 1: " 1/8", 2: " 1/4", 3: " 3/8", 4: " 1/2", 5: " 5/8", 6: " 3/4", 7: " 7/8", 8: "" }[eighths];
    const w = eighths === 8 ? whole + 1 : whole;
    return (w ? String(w) : "") + (w && f ? f : f.trim()) + " inch";
  }

  // Plain-language description of a turf line, built only from published specs.
  function describeTurf(line) {
    const s = line.specs || {}, raw = line.specsRaw || {};
    const pile = fmtPile(s.pileHeightIn);
    const parts = [];
    if (pile) parts.push(`${pile} pile height`);
    if (s.faceWeightOz) parts.push(`${s.faceWeightOz} oz face weight (${s.faceWeightOz >= 75 ? "dense and plush" : s.faceWeightOz >= 55 ? "full" : "lighter and more open"})`);
    const yarn = s.yarnColor || raw["Yarn Color"];
    if (yarn) parts.push(`blade colors ${yarn.replace(/\s*\/\s*/g, " and ")} green`);
    const thatch = s.thatchColor || raw["Thatch Color"];
    if (thatch && !/n\/?a/i.test(thatch)) parts.push(`a curly ${thatch.replace(/\s*\/\s*/g, " and ").toLowerCase()} thatch layer low in the pile`);
    if (s.bladeShape && !/nylon|slit/i.test(s.bladeShape)) parts.push(`${s.bladeShape.toLowerCase()}-shaped blades`);
    return parts.join(", ");
  }

  // Visual translation of the published specs, so pile height, fullness and blade shape change how the
  // lawn LOOKS (not just its color). Heights and weights are TurfHub's published numbers.
  function lookProfile(line) {
    const s = line.specs || {}, raw = line.specsRaw || {};
    const pile = Number(s.pileHeightIn) || 1.5, oz = Number(s.faceWeightOz) || 60;
    const hc = pile <= 1.3 ? 1 : pile <= 1.5 ? 2 : pile <= 1.7 ? 3 : pile <= 1.9 ? 4 : 5;
    const height = ["",
      "very short and tidy, like a closely mown golf fairway: the blades are short and stand at one low uniform height, individual blades are barely visible beyond a few feet, and the surface looks flat, smooth and fine",
      "short and neat, like a tidy cut lawn: blades are short and fine, with a soft low nap and only a little lean",
      "medium height, a natural cut-lawn look: blades are visibly longer, lean and overlap a little, with soft shading between them",
      "tall and lush: long blades that lean and overlap in different directions with soft shadow between them, giving a deeper, plusher surface than a normal cut lawn",
      "very tall and plush: long, dense blades clearly longer than a normal lawn, leaning and fanning in different directions with deep shadow between them, like an uncut but well kept lawn"][hc];
    const dens = oz >= 85 ? "very dense and full, no backing visible anywhere" : oz >= 70 ? "dense and full" : oz >= 55 ? "full, with a light amount of space between blades" : "lighter and more open, with some thatch and space between blades visible";
    const shape = s.bladeShape ? `blade shape: ${String(s.bladeShape).toLowerCase().replace(/\s*blade$/, "")}, ${/wave|hollow|c|spine|diamond|m-?shape|s-?shape|omega/i.test(s.bladeShape) ? "a matte, low-sheen surface with no plastic shine" : "natural fine blades"}` : "natural fine blades with a matte, low-sheen surface";
    const thatch = (s.thatchColor || raw["Thatch Color"] || "") && !/n\/?a/i.test(s.thatchColor || "") ? `curly ${String(s.thatchColor).replace(/\s*\/\s*/g, " and ").toLowerCase()} thatch visible low between the blades` : "";
    return { heightClass: hc, text: `Pile height ${fmtPile(pile)} (${hc} on a 1 to 5 scale of TurfHub heights): ${height}. Fullness ${oz} oz: ${dens}. ${shape}.${thatch ? " " + thatch.charAt(0).toUpperCase() + thatch.slice(1) + "." : ""}` };
  }

  function isPutting(line) {
    return (line.uses || []).includes("putting");
  }

  function scaleClause(line) {
    const pile = Number((line.specs || {}).pileHeightIn) || 1.5;
    if (pile <= 0.7) return "This is short putting-green turf: a tight, dense, low surface like a golf green, with no long blades, no visible thatch curls and no lawn texture.";
    return `Blades are about ${fmtPile(pile)} tall, similar to a freshly cut real lawn. The camera is a phone held at standing height, so even at the very bottom edge of the frame the ground is several feet away: individual blades there are thin, short strands only a few pixels wide, never bigger than a pencil line, and the lowest strip of the image looks just like the rest of the lawn, only slightly sharper. NEVER draw large, tall, close-up or out-of-focus blades, a grass border or a macro view of the turf anywhere, especially along the bottom edge. Blades merge into an even fine texture by mid distance, and far away the lawn reads as one smooth, even green. Blade size shrinks steadily with distance, like in any real photograph.`;
  }

  // Appended to angles 2 and 3 of a set: the first angle's finished render is attached as REFERENCE RENDER so every
// angle shows the same project (same turf look, same putting green design), each in its own photo and camera angle.
  const REF_CLAUSE = "SAME PROJECT AS THE REFERENCE RENDER. The image labeled REFERENCE RENDER is the finished result of this same project, already installed, photographed from a different angle of the same property. Install the identical product and design: the same turf look (blade color mix, blade length, fullness, thatch and lean) and, if there is a putting green, the SAME green: the same shape, the same overall size, the same collar width, the same number of cups with white flagsticks, the same border or edge, and the same two-tone fringe. Show it as it would look from THIS photo's camera position and perspective. Use the reference ONLY for the look and design of the new installation. Never copy its camera angle, framing, background objects or scene: the FIRST image alone decides the scene, framing and viewpoint.";

  function build({ line, area = "backyard", preset = "none", puttingLine = null, size = "m", place = null, guide = false, mode = "lawn", border = "auto", hasRef = false }) {
    if (!line) throw new Error("line required");
    if (mode === "putt") return buildPutting({ line: puttingLine || line, area, preset, size, border, place, guide, hasRef });
    const a = AREAS[area] || AREAS.backyard;
    const p = PRESETS[preset] && preset !== "none" ? PRESETS[preset] : null;
    const putting = p ? (puttingLine || null) : null;
    const lines = [
      "TASK: photo edit with a locked camera. The FIRST image is the photograph to edit. It is the canvas: the output must be the same photograph, same framing, same objects in the same positions, with only the ground surface changed. The SECOND image (and the THIRD, if present) is a studio reference photo of the exact artificial turf to install, shown from above and from the edge. The reference photos are NOT part of the scene.",
      "",
      `Replace ${a.target} with professionally installed artificial turf: TurfHub ${line.name}, ${describeTurf(line)}.`,
      "",
      "READ THE SAMPLE CORRECTLY. The sample is a close-up of a piece only about one foot square on a white background. Use it ONLY to learn the exact blade colors, the mix of lighter and darker blades, the thatch color and the blade character. Never paste, tile or place the sample (or any enlarged, giant or close-up version of its blades) in the scene. Never reproduce its white background, black backing, cut edges or square shape. No oversized foreground grass anywhere, including along the bottom edge of the frame.",
      "",
      "LOOK AND FEEL. The turf must look like THIS product and no other, the way its reference photos look: " + lookProfile(line).text + " Match the reference photos for blade length-to-width, fullness, curl and how upright the blades stand. A shorter, finer turf must look visibly shorter and tidier than a taller, plusher one in the finished photograph. Pile height changes ONLY the texture of the turf surface. It never changes the lighting, shadows, camera, composition or any object, and never adds a pool, patio, edging or hardscape.",
      "",
      "COLOR. Take the green tones and their mix from the sample exactly, including the brown thatch where the product has it. Do not shift the turf toward a brighter, more saturated, more yellow or more blue green than the sample, and do not copy the color of any grass or dirt being replaced. Let the photograph's own sunlight and shade set brightness, never the hue.",
      "",
      "SCALE AND DEPTH. " + scaleClause(line),
      "",
      "BLADE REALISM. Blades lean in random directions with natural variation, like real fibers. No repeating rows, no rake lines, no stripes, no regular grid of upright spikes and no copy-pasted texture anywhere in the turf.",
      "",
      "INSTALLATION. The turf lies flat and follows the existing grade. It ends in clean, crisp edges tight against every curb, paver, walkway, patio, planter wall, fence, house wall and garden bed, following the original lawn boundary. No visible seams, no rolled edges, no mowing stripes, no checkerboard, no patchiness, no dead or brown spots, no weeds, no puddles.",
    ];
    if (p) {
      const f = footprint(preset, size), sz = SIZES[size] || SIZES.m;
      const where = place
        ? `Center it at about ${Math.round(place.x * 100)} percent from the left edge and ${Math.round(place.y * 100)} percent from the top edge of the frame, on the ground. ${guide ? "The LAST image is the same photograph with a white outline drawn on it: that outline is the exact footprint, position and size of the green. Build the green inside that outline, then do not draw the outline itself. " : ""}Its footprint spans about ${Math.round(sz.w * 100 * (place.rot ? 0.75 : 1))} percent of the frame width at that depth, with the long side running ${place.rot ? "toward the camera, following the perspective" : "across the frame, following the perspective"}.`
        : "Place it in the open part of the new turf where a homeowner would want it, on the ground.";
      lines.push("", `PUTTING GREEN. Inside the new turf area, add ${p.desc}. About ${f.sqft} square feet, roughly ${f.widthFt} by ${f.lengthFt} feet. It has ${f.cups} cups, each with a white flagstick, spaced apart at different angles and not at the edge. A collar of the landscape turf about 2 to 3 feet wide runs around the whole green. ${where} The putting surface is ${putting ? `TurfHub ${putting.name}, ${describeTurf(putting)}` : "short, tight putting-green turf"}: a fine, dense, perfectly even short-cut surface, visibly shorter, smoother and slightly darker than the surrounding lawn turf, with a crisp cut line. Cups are flush with the surface. Keep the green entirely on the ground plane with correct perspective and the same size relative to nearby objects as a real ${f.widthFt} by ${f.lengthFt} foot green.`);
    }
    if (hasRef) lines.push("", REF_CLAUSE);
    lines.push("", "CHANGE NOTHING ELSE. Treat every pixel that is not the ground being replaced as locked. The house and its walls, roof, windows, shutters, doors, fences, block walls, pool, patio, concrete, existing pavers, rocks, trees, shrubs, utility boxes, sky, shadows, camera angle, lens, framing and time of day stay identical to the FIRST image. ADD NOTHING that is not in the FIRST image: no new pavers, borders, edging, curbs, planting beds, shrubs, flowers, rocks, furniture, windows or buildings. If the original ground meets a wall or fence with no border, the turf runs straight to the base of that wall. Do not crop, zoom, widen or re-compose the shot. No people, pets, text, logos or watermarks. The result must look like the same unretouched photograph of the same property taken right after installation.");
    return lines.join("\n");
  }

  // Putting-green-only projects: just a green (and its collar) on the existing ground; everything else stays as it is.
  function buildPutting({ line, area = "backyard", preset = "kidney", size = "m", border = "auto", place = null, guide = false, hasRef = false }) {
    if (!line) throw new Error("line required");
    const a = AREAS[area] || AREAS.backyard, pr = PRESETS[preset] && preset !== "none" ? PRESETS[preset] : PRESETS.kidney, f = footprint(PRESETS[preset] && preset !== "none" ? preset : "kidney", size);
    return [
      "TASK: photo edit with a locked camera. The FIRST image is the photograph to edit. It is the canvas: the output must be the same photograph, same framing, same objects in the same positions, with only ONE addition. The SECOND image (and the THIRD, if present) is a studio reference photo of the exact putting-green turf to install, shown from above and from the edge. The reference photos are NOT part of the scene.",
      "",
      `Install ONLY a putting green in the open ground of ${a.target}. ${place ? `Center it at about ${Math.round(place.x * 100)} percent from the left edge and ${Math.round(place.y * 100)} percent from the top edge of the frame, on the ground. ${guide ? "The LAST image is the same photograph with a white outline drawn on it: that outline is the exact footprint, position and size of the green. Build the green inside that outline, then do not draw the outline itself. " : ""}` : ""}It is ${pr.desc}. ${(SIZES[size] || SIZES.m).fill ? `It is sized to fill most of the open ground of that area, leaving only a modest margin of the existing ground around it (about ${f.sqft} square feet, roughly ${f.widthFt} by ${f.lengthFt} feet)` : `About ${f.sqft} square feet, roughly ${f.widthFt} by ${f.lengthFt} feet`}, with ${f.cups} cups each with a white flagstick, spaced apart at different angles and not at the edge.`,
      "",
      "TWO-TONE FRINGE. Around the putting surface runs a fringe band 2 to 3 feet wide of slightly taller, darker green turf with a soft, fuller look, so the green reads as two tones: a lighter, very short, smooth putting surface inside, and a darker fringe around it, with a crisp clean line between them.",
      "",
      `BORDER. Around the outside of the fringe, separating the green from the existing ground, there is ${(BORDERS[border] || BORDERS.auto).desc}.`,
      "",
      `The putting surface is TurfHub ${line.name}, ${describeTurf(line)}: a fine, dense, perfectly even short-cut surface with no visible blades, no shine and a soft matte finish. ${scaleClause(line)}`,
      "",
      "READ THE SAMPLE CORRECTLY. The sample is a close-up of a piece only about one foot square on a white background. Use it ONLY to learn the exact color and surface character. Never paste, tile or place the sample (or any enlarged version of it) in the scene, and never reproduce its white background, black backing, cut edges or square shape.",
      "",
      ...(hasRef ? [REF_CLAUSE, ""] : []),
      "THE REST OF THE YARD STAYS EXACTLY AS IT IS. Every other part of the ground (existing lawn, dry grass, dirt, gravel, decomposed granite, pavers, concrete) must remain untouched, with its own color, texture and condition. Do NOT turn any of the rest of the ground into artificial turf or new lawn.",
      "",
      "INSTALLATION. The green lies flat on the ground plane with correct perspective, follows the existing grade, and is the right size relative to nearby objects for a real green of that size. Cups are flush with the surface. No seams, no rolled edges, no stripes, no repeating pattern.",
      "",
      "CHANGE NOTHING ELSE. The house, roof, windows, doors, fences, block walls, pool, patio, existing pavers, rocks, trees, shrubs, utility boxes, furniture, sky, shadows, camera angle, lens, framing and time of day stay identical to the FIRST image. Do not add any other object, border, edging, planter, wall or hardscape. No people, pets, text, logos or watermarks. The result must look like the same unretouched photograph of the same property taken right after a putting green was installed.",
    ].join("\n");
  }

  return { AREAS, PRESETS, SIZES, BORDERS, footprint, cupsFor, buildPutting, describeTurf, lookProfile, build, fmtPile, isPutting };
});
