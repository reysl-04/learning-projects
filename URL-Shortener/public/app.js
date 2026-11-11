const STORAGE_KEY = "shortener:recent";
const MAX_RECENT = 8;

const form = document.querySelector("#shorten-form");
const urlInput = document.querySelector("#url");
const aliasInput = document.querySelector("#alias");
const ttlSelect = document.querySelector("#ttl");
const submitButton = document.querySelector("#submit");
const errorBox = document.querySelector("#error");
const resultBox = document.querySelector("#result");
const shortUrlInput = document.querySelector("#short-url");
const copyResultButton = document.querySelector("#copy-result");
const openResultLink = document.querySelector("#open-result");
const resultExpiry = document.querySelector("#result-expiry");
const resultClicks = document.querySelector("#result-clicks");
const recentList = document.querySelector("#recent-list");
const recentEmpty = document.querySelector("#recent-empty");
const recentCount = document.querySelector("#recent-count");

function loadRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.code) : [];
  } catch {
    return [];
  }
}

function saveRecent(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
}

function setError(message) {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.classList.toggle("is-loading", isLoading);
}

function formatExpiry(iso) {
  if (!iso) return "Never expires";
  const date = new Date(iso);
  return `Expires ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function pluralClicks(count) {
  return `${count} ${count === 1 ? "click" : "clicks"}`;
}

async function copyText(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    shortUrlInput?.select();
    document.execCommand?.("copy");
    button.textContent = "Copied";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function renderRecent() {
  const items = loadRecent();
  recentList.replaceChildren();
  recentCount.textContent = String(items.length);
  recentEmpty.hidden = items.length > 0;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "recent-item";

    const main = document.createElement("div");
    main.className = "recent-main";

    const codeLink = document.createElement("a");
    codeLink.className = "recent-code";
    codeLink.href = `/${item.code}`;
    codeLink.target = "_blank";
    codeLink.rel = "noopener noreferrer";
    codeLink.textContent = `/${item.code}`;

    const target = document.createElement("span");
    target.className = "recent-target";
    target.textContent = item.url;
    target.title = item.url;

    main.append(codeLink, target);

    const side = document.createElement("div");
    side.className = "recent-side";

    const clicks = document.createElement("span");
    clicks.className = "clicks";
    clicks.textContent = pluralClicks(item.clicks ?? 0);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "icon-btn";
    copyButton.title = "Copy short link";
    copyButton.setAttribute("aria-label", `Copy short link for ${item.code}`);
    copyButton.textContent = "⧉";
    copyButton.addEventListener("click", () => copyText(item.shortUrl, copyButton));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "icon-btn";
    deleteButton.title = "Delete link";
    deleteButton.setAttribute("aria-label", `Delete link ${item.code}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", async () => {
      deleteButton.disabled = true;
      try {
        await fetch(`/api/links/${encodeURIComponent(item.code)}`, { method: "DELETE" });
      } catch {
        // Offline is fine: drop it locally anyway.
      }
      const remaining = loadRecent().filter((entry) => entry.code !== item.code);
      saveRecent(remaining);
      renderRecent();
    });

    side.append(clicks, copyButton, deleteButton);
    li.append(main, side);
    recentList.append(li);
  }

  refreshStats(items);
}

async function refreshStats(items) {
  await Promise.all(
    items.map(async (item) => {
      try {
        const response = await fetch(`/api/links/${encodeURIComponent(item.code)}`);
        if (!response.ok) return;
        const stats = await response.json();
        const current = loadRecent();
        const match = current.find((entry) => entry.code === item.code);
        if (!match) return;
        match.clicks = stats.clicks;
        saveRecent(current);
        renderCounts();
      } catch {
        // Stats are a nice-to-have; never block the page on them.
      }
    }),
  );
}

function renderCounts() {
  const items = loadRecent();
  const nodes = recentList.querySelectorAll(".recent-item");
  nodes.forEach((node, index) => {
    const count = node.querySelector(".clicks");
    if (count && items[index]) count.textContent = pluralClicks(items[index].clicks ?? 0);
  });
}

function showResult(link) {
  shortUrlInput.value = link.shortUrl;
  openResultLink.href = link.shortUrl;
  resultExpiry.textContent = formatExpiry(link.expiresAt);
  resultClicks.textContent = pluralClicks(link.clicks);
  resultBox.hidden = false;
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");

  const url = urlInput.value.trim();
  if (!url) {
    setError("Paste a URL first.");
    urlInput.focus();
    return;
  }

  const body = { url, ttlSeconds: Number(ttlSelect.value) };
  const alias = aliasInput.value.trim();
  if (alias) body.alias = alias;

  setLoading(true);
  try {
    const response = await fetch("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      setError(await readError(response));
      return;
    }

    const link = await response.json();
    showResult(link);

    const items = loadRecent().filter((item) => item.code !== link.code);
    items.unshift({
      code: link.code,
      shortUrl: link.shortUrl,
      url: link.url,
      clicks: link.clicks,
    });
    saveRecent(items);
    renderRecent();

    form.reset();
    ttlSelect.value = "0";
  } catch {
    setError("Could not reach the server. Is it running?");
  } finally {
    setLoading(false);
  }
});

copyResultButton.addEventListener("click", () => {
  if (shortUrlInput.value) copyText(shortUrlInput.value, copyResultButton);
});

renderRecent();
