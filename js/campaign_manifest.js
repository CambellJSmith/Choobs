---
layout: null
---
"use strict";

window.CHOOBS_CAMPAIGN_FILES = Object.freeze([
{% assign sorted_campaign_files = site.static_files | sort: "path" %}
{% for file in sorted_campaign_files %}
{% if file.path contains "/levels/" %}
{% if file.extname == ".json" %}
    ".{{ file.path }}",
{% endif %}
{% endif %}
{% endfor %}
]);
