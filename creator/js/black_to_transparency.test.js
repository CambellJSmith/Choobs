(() => {
    "use strict";

    const luminance_threshold = 18;
    const chroma_threshold = 10;

    function is_effectively_black(red, green, blue) {
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const chroma = maximum - minimum;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        return luminance <= luminance_threshold && chroma <= chroma_threshold;
    }

    console.assert(is_effectively_black(0, 0, 0), "pure black should be transparent");
    console.assert(is_effectively_black(16, 16, 16), "near-black grey should be transparent");
    console.assert(!is_effectively_black(32, 32, 32), "dark grey should remain available");
    console.assert(!is_effectively_black(32, 0, 0), "dark red should remain available");
    console.assert(!is_effectively_black(0, 32, 0), "dark green should remain available");
    console.assert(!is_effectively_black(0, 0, 32), "dark blue should remain available");
})();
