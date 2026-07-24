const listEl = document.getElementById("book-list");
const detailEl = document.getElementById("detail");
const detailTitle = document.getElementById("detail-title");
const detailJson = document.getElementById("detail-json");
const btnRefresh = document.getElementById("btn-refresh");

async function loadBooks() {
  const res = await fetch("/api/books");
  const data = await res.json();
  listEl.innerHTML = "";
  for (const b of data.books ?? []) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="title">${escapeHtml(b.title)}</div>
      <div class="meta">${escapeHtml(b.id)} · v${escapeHtml(b.version)} · ${b.pageCount} pages</div>`;
    li.addEventListener("click", () => {
      for (const n of listEl.children) n.classList.remove("active");
      li.classList.add("active");
      void openBook(b.id);
    });
    listEl.appendChild(li);
  }
  if (!(data.books ?? []).length) {
    listEl.innerHTML = `<li class="meta">暂无图书，请查看 content/books</li>`;
  }
}

async function openBook(id) {
  const res = await fetch(`/api/books/${encodeURIComponent(id)}`);
  const book = await res.json();
  detailEl.hidden = false;
  detailTitle.textContent = book.title ?? id;
  detailJson.textContent = JSON.stringify(book, null, 2);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

btnRefresh.addEventListener("click", () => void loadBooks());
void loadBooks();
