(function(ui) {
    // 过滤图书列表
    async function filterBooks() {
        let books = await window.HRStorage.listBooks();
        const state = window.HRStorage.readState();

        // 1. 分类过滤
        if (ui.state.currentCategory === "fav") {
            books = books.filter(b => state.favorites.includes(b.id));
        } else if (ui.state.currentCategory === "history") {
            const historyIds = state.history.map(h => h.bookId);
            books = books.filter(b => historyIds.includes(b.id));
            books.sort((a, b) => {
                const idxA = historyIds.indexOf(a.id);
                const idxB = historyIds.indexOf(b.id);
                return idxA - idxB;
            });
        } else if (ui.state.currentCategory !== "all") {
            books = books.filter(b => b.category === ui.state.currentCategory);
        }

        // 2. 关键字搜索
        if (ui.state.currentKeyword) {
            const kw = ui.state.currentKeyword.toLowerCase();
            books = books.filter(b => b.title.toLowerCase().includes(kw) || b.author.toLowerCase().includes(kw));
        }

        return books;
    }

    // 渲染左侧 Tabs
    ui.renderTabs = async function() {
        const { tabsEl } = ui.root();
        
        if (ui.state.currentView === "library") {
            const state = window.HRStorage.readState();
            const books = await window.HRStorage.listBooks();
            
            // 计算各个分类的书本数量
            const counts = { all: books.length, classics: 0, modern: 0, local: 0 };
            books.forEach(b => {
                if (counts[b.category] !== undefined) counts[b.category]++;
            });

            const categories = [
                { key: "all", label: "全部图书", count: counts.all },
                { key: "classics", label: "国学经典", count: counts.classics },
                { key: "modern", label: "现代文学", count: counts.modern },
                { key: "local", label: "本地导入", count: counts.local },
                { key: "fav", label: "我的收藏", count: state.favorites.length },
                { key: "history", label: "历史记录", count: state.history.length }
            ];

            tabsEl.innerHTML = categories.map(c => {
                const activeCls = c.key === ui.state.currentCategory ? "active" : "";
                return `<button class="category-tab ${activeCls}" data-cat="${c.key}">${c.label} <span style="opacity:.6; margin-left:2px;">${c.count}</span></button>`;
            }).join("");

            tabsEl.querySelectorAll(".category-tab").forEach(btn => {
                btn.addEventListener("click", () => {
                    ui.state.currentCategory = btn.dataset.cat;
                    ui.renderTabs();
                    ui.renderList();
                });
            });
        } else if (ui.state.currentView === "reading") {
            tabsEl.innerHTML = `
                <button class="category-tab active" data-readtab="toc">章节目录</button>
                <button class="category-tab" data-readtab="bookmarks">书签笔记</button>
            `;

            tabsEl.querySelectorAll(".category-tab").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    tabsEl.querySelectorAll(".category-tab").forEach(t => t.classList.remove("active"));
                    btn.classList.add("active");
                    const readTab = btn.dataset.readtab;
                    ui.renderReadingList(readTab);
                });
            });
        }
    };

    // 渲染左副栏列表
    ui.renderList = async function() {
        const { listEl } = ui.root();
        
        if (ui.state.currentView === "library") {
            const filtered = await filterBooks();
            if (filtered.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-state">
                        <strong>暂无图书</strong>
                        在左下角点击“导入图书”，或从分类中查找。
                    </div>`;
                return;
            }

            const state = window.HRStorage.readState();
            listEl.innerHTML = filtered.map((b, idx) => {
                const isFav = state.favorites.includes(b.id);
                const isActive = ui.state.currentBookId === b.id;
                const format = b.format ? b.format.toUpperCase() : "TXT";
                const hist = state.history.find(h => h.bookId === b.id);
                const progressText = hist ? `已读至第 ${hist.chapterIdx + 1} 章` : "未开始阅读";

                return `
                    <div class="list-item ${isActive ? "active" : ""}" data-id="${b.id}">
                        <div class="item-info">
                            <span class="item-title">${String(idx + 1).padStart(2, "0")} · ${ui.escapeHtml(b.title)}</span>
                            <span class="item-subtitle">${ui.escapeHtml(b.author)} · ${progressText}</span>
                        </div>
                        <button class="fav-star ${isFav ? "is-fav" : ""}" title="收藏">${isFav ? "★" : "☆"}</button>
                        <span class="badge ${isActive ? "active" : ""}">${format}</span>
                    </div>
                `;
            }).join("");

            listEl.querySelectorAll(".list-item").forEach(el => {
                el.addEventListener("click", (e) => {
                    if (e.target.classList.contains("fav-star")) return;
                    const bId = el.dataset.id;
                    ui.selectAndOpenBook(bId);
                });

                el.querySelector(".fav-star").addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const bId = el.dataset.id;
                    const isFaved = await window.HRStorage.toggleFavorite(bId);
                    e.target.textContent = isFaved ? "★" : "☆";
                    e.target.className = `fav-star ${isFaved ? "is-fav" : ""}`;
                    ui.renderTabs();
                });
            });
        } else if (ui.state.currentView === "reading") {
            const activeTab = document.querySelector(".category-tabs .category-tab.active");
            const tabType = activeTab ? activeTab.dataset.readtab : "toc";
            ui.renderReadingList(tabType);
        }
    };

    // 渲染阅读辅助列表
    ui.renderReadingList = function(tabType) {
        const { listEl } = ui.root();
        if (!ui.state.currentBook) return;

        if (tabType === "toc") {
            const filteredChapters = ui.state.currentBook.chapters
                .map((c, i) => ({ ...c, idx: i }))
                .filter(c => c.title.toLowerCase().includes(ui.state.currentKeyword.toLowerCase()));

            if (filteredChapters.length === 0) {
                listEl.innerHTML = `<div class="empty-state">未找到匹配章节</div>`;
                return;
            }

            listEl.innerHTML = filteredChapters.map(c => {
                const isActive = ui.state.currentChapterIdx === c.idx;
                return `
                    <div class="list-item ${isActive ? "active" : ""}" data-idx="${c.idx}">
                        <div class="item-info">
                            <span class="item-title">${ui.escapeHtml(c.title)}</span>
                        </div>
                        <span class="badge ${isActive ? "active" : ""}">${isActive ? "正在阅读" : "章节"}</span>
                    </div>
                `;
            }).join("");

            listEl.querySelectorAll(".list-item").forEach(el => {
                el.addEventListener("click", () => {
                    const idx = parseInt(el.dataset.idx, 10);
                    ui.jumpToChapter(idx);
                });
            });
        } else if (tabType === "bookmarks") {
            const state = window.HRStorage.readState();
            const bookBookmarks = (state.bookmarks || []).filter(b => b.bookId === ui.state.currentBookId);
            
            if (bookBookmarks.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-state">
                        <strong>暂无书签笔记</strong>
                        在右侧阅读时，选中文字或直接点击顶部“添加书签”来创建。
                    </div>`;
                return;
            }

            listEl.innerHTML = bookBookmarks.map((b, idx) => {
                const text = b.selectedText ? `“${b.selectedText}”` : "无字书签";
                return `
                    <div class="list-item" data-idx="${b.chapterIdx}" data-percent="${b.percent}">
                        <div class="item-info">
                            <span class="item-title">${ui.escapeHtml(b.chapterTitle)} (${b.percent}%)</span>
                            <span class="item-subtitle">${ui.escapeHtml(text)}</span>
                        </div>
                        <button class="fav-star is-fav" data-bookmark-id="${b.id}" title="删除书签">×</button>
                    </div>
                `;
            }).join("");

            listEl.querySelectorAll(".list-item").forEach(el => {
                el.addEventListener("click", (e) => {
                    if (e.target.classList.contains("fav-star")) return;
                    const idx = parseInt(el.dataset.idx, 10);
                    const percent = parseFloat(el.dataset.percent);
                    ui.jumpToChapter(idx, percent);
                });

                el.querySelector(".fav-star").addEventListener("click", (e) => {
                    e.stopPropagation();
                    const bId = e.target.dataset.bookmarkId;
                    ui.deleteBookmark(bId);
                });
            });
        }
    };

})(window.HRUi);
