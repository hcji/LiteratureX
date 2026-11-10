(function () {
  'use strict'

  var cfg = window.__LX_CONFIG__ || {}
  var KEY = 'literaturex.citationIds'
  var CITATION_KEY = 'literaturex.citations'
  var BIBLIOGRAPHY_KEY = 'literaturex.bibliography'
  var state = {
    items: [],
    selected: {},
    cited: [],
    citations: [],
    bibliographyBookmark: null,
    formatId: 'builtin-numeric',
    template: null,
    formats: [],
    publicStyleUrl: 'https://www.zotero.org/styles',
    host: 'preview',
    canInsert: false,
    loading: false,
    connected: false,
    started: false
  }

  var root = document.getElementById('app')
  var toastTimer = null

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function renderShell() {
    root.innerHTML =
      '<div class="lx-header">' +
      '  <div class="lx-logo">Lx</div>' +
      '  <div class="lx-brand-text">' +
      '    <div class="lx-title">LiteratureX</div>' +
      '    <div class="lx-sub">参考文献助手 / References</div>' +
      '  </div>' +
      '  <button type="button" class="lx-icon-btn" id="lx-prefs-open" title="文档首选项">⚙</button>' +
      '  <button type="button" class="lx-icon-btn" id="lx-refresh" title="刷新">↻</button>' +
      '</div>' +
      '<div class="lx-status">' +
      '  <span class="lx-dot" id="lx-dot"></span>' +
      '  <span id="lx-status-text">正在连接 LiteratureX…</span>' +
      '  <span class="lx-cited" id="lx-cited">已引用 0</span>' +
      '</div>' +
      '<div class="lx-toolbar">' +
      '  <input type="search" class="lx-search" id="lx-search" placeholder="搜索标题、作者、DOI…" autocomplete="off">' +
      '  <select class="lx-format" id="lx-format" title="引用格式"></select>' +
      '</div>' +
      '<div class="lx-results" id="lx-results"></div>' +
      '<div class="lx-footer">' +
      '  <div class="lx-selected" id="lx-selected">已选 0 篇</div>' +
      '  <div class="lx-actions">' +
      '    <button type="button" class="lx-btn primary" id="lx-insert" disabled>插入引用</button>' +
      '    <button type="button" class="lx-btn" id="lx-bib" disabled>参考文献表</button>' +
      '  </div>' +
      '</div>' +
      '<div class="lx-toast" id="lx-toast"></div>' +
      '<div class="lx-modal" id="lx-prefs" hidden>' +
      '  <div class="lx-modal-card">' +
      '    <div class="lx-modal-head"><strong>文档首选项</strong><button type="button" class="lx-icon-btn" id="lx-prefs-close">×</button></div>' +
      '    <div class="lx-modal-body">' +
      '      <div class="lx-section-title">引用格式</div>' +
      '      <div class="lx-format-list" id="lx-format-list"></div>' +
      '      <label class="lx-toggle"><input type="checkbox" id="lx-numbered"> 参考文献列表显示序号</label>' +
      '      <button type="button" class="lx-link" id="lx-public-styles">打开公开 CSL 样式库 ↗</button>' +
      '      <div class="lx-section-title" style="margin-top:14px">从示例学习格式（LLM）</div>' +
      '      <textarea class="lx-example" id="lx-example" rows="4" placeholder="粘贴一个参考文献示例，例如：Ji, H., Wang, M. Deep learning for mass spectra. J. Nat. Prod., 2024, 87(4), 1001-1012."></textarea>' +
      '      <div class="lx-row"><button type="button" class="lx-btn primary" id="lx-analyze">分析并保存格式</button><span class="lx-analyze-status" id="lx-analyze-status"></span></div>' +
      '      <div class="lx-hint">公开样式库提供 CSL 格式；示例分析会把格式保存为本地模板，之后可随时选用。</div>' +
      '    </div>' +
      '  </div>' +
      '</div>'

    document.getElementById('lx-refresh').addEventListener('click', function () {
      refreshStatus()
      doSearch(document.getElementById('lx-search').value)
      refreshCitations().then(function (refreshed) {
        if (refreshed) toast('引用与参考文献已刷新')
      })
    })
    document.getElementById('lx-search').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') doSearch(event.target.value)
    })
    document.getElementById('lx-format').addEventListener('change', function (event) {
      selectFormat(event.target.value)
      renderResults()
    })
    document.getElementById('lx-prefs-open').addEventListener('click', openPreferences)
    document.getElementById('lx-prefs-close').addEventListener('click', closePreferences)
    document.getElementById('lx-prefs').addEventListener('click', function (event) {
      if (event.target && event.target.id === 'lx-prefs') closePreferences()
    })
    document.getElementById('lx-public-styles').addEventListener('click', function () {
      try {
        window.open(state.publicStyleUrl, '_blank')
      } catch (error) {
        toast('无法打开样式库：' + (error && error.message ? error.message : error), true)
      }
    })
    document.getElementById('lx-analyze').addEventListener('click', analyzeExample)
    document.getElementById('lx-numbered').addEventListener('change', function (event) {
      if (!state.template) return
      try {
        localStorage.setItem('literaturex.numbered.' + state.template.id, event.target.checked ? '1' : '0')
      } catch (error) {
        /* localStorage may be unavailable */
      }
      state.template.numbered = event.target.checked
      refreshBibliography()
    })
    document.getElementById('lx-format-list').addEventListener('change', function (event) {
      var input = event.target
      if (!input || input.type !== 'radio') return
      selectFormat(input.value)
      renderResults()
      renderFormatList()
    })
    document.getElementById('lx-format-list').addEventListener('click', function (event) {
      var target = event.target
      while (target && target !== this && !target.getAttribute) target = target.parentNode
      var id = target && target.getAttribute ? target.getAttribute('data-delete-format') : null
      if (id) {
        event.preventDefault()
        deleteFormat(id)
      }
    })
    document.getElementById('lx-format-list').addEventListener('contextmenu', function (event) {
      var target = event.target
      while (target && target !== this && !target.getAttribute) target = target.parentNode
      var id = target && target.getAttribute ? target.getAttribute('data-format-id') : null
      if (!id) return
      event.preventDefault()
      showFormatMenu(event, id)
    })
    document.getElementById('lx-insert').addEventListener('click', insertCitation)
    document.getElementById('lx-bib').addEventListener('click', insertBibliography)
    document.getElementById('lx-results').addEventListener('change', function (event) {
      var input = event.target
      if (!input || input.type !== 'checkbox') return
      var id = input.getAttribute('data-id')
      if (!id) return
      if (input.checked) state.selected[id] = true
      else delete state.selected[id]
      updateFooter()
    })
  }

  function toast(message, isError) {
    var node = document.getElementById('lx-toast')
    if (!node) return
    node.textContent = message
    node.className = 'lx-toast show' + (isError ? ' error' : '')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      node.className = 'lx-toast'
    }, 2600)
  }

  function setStatus(ok, text) {
    var dot = document.getElementById('lx-dot')
    var label = document.getElementById('lx-status-text')
    if (dot) dot.className = 'lx-dot' + (ok === true ? ' ok' : ok === false ? ' err' : '')
    if (label) label.textContent = text
  }

  function apiGet(path) {
    return fetch(cfg.apiBase + path, {
      headers: { 'X-LiteratureX-Token': cfg.token || '' }
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status)
      return response.json()
    })
  }

  function apiSend(method, path, body) {
    return fetch(cfg.apiBase + path, {
      method: method,
      headers: {
        'X-LiteratureX-Token': cfg.token || '',
        'Content-Type': 'application/json'
      },
      body: body == null ? undefined : JSON.stringify(body)
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error((data && data.error) || 'HTTP ' + response.status)
        return data
      })
    })
  }

  function refreshStatus() {
    return apiGet('/api/plugin/status')
      .then(function (data) {
        state.connected = true
        setStatus(true, state.host + ' · 已连接 · ' + data.count + ' 篇文献')
        return data
      })
      .catch(function () {
        state.connected = false
        setStatus(false, '未连接 · 请先启动 LiteratureX')
        return null
      })
  }

  function doSearch(query) {
    if (state.loading) return Promise.resolve()
    state.loading = true
    var results = document.getElementById('lx-results')
    if (results) results.innerHTML = '<div class="lx-empty"><span class="lx-spinner"></span>正在搜索…</div>'
    var path = '/api/plugin/search?limit=40&q=' + encodeURIComponent(query || '')
    return apiGet(path)
      .then(function (data) {
        state.items = data.items || []
        state.connected = true
        renderResults()
        setStatus(true, state.host + ' · 已连接 · ' + (data.total != null ? data.total : state.items.length) + ' 篇文献')
      })
      .catch(function () {
        state.connected = false
        state.items = []
        if (results) {
          results.innerHTML =
            '<div class="lx-empty">无法连接 LiteratureX。<br>请先启动 LiteratureX 桌面应用，然后点击右上角刷新。</div>'
        }
        setStatus(false, '未连接 · 请先启动 LiteratureX')
      })
      .then(function () {
        state.loading = false
        updateFooter()
      })
  }

  function familyName(name) {
    var value = String(name || '').trim()
    if (!value) return ''
    if (value.indexOf(',') >= 0) return value.split(',')[0].trim()
    var parts = value.split(/\s+/)
    return parts.length > 1 ? parts[parts.length - 1] : value
  }

  function authorYear(ref) {
    var authors = ref.authors || []
    var first = authors.length ? familyName(authors[0]) : 'Anon'
    return first + (authors.length > 1 ? ' et al.' : '') + ', ' + (ref.year || 'n.d.')
  }

  function renderResults() {
    var container = document.getElementById('lx-results')
    if (!container) return
    if (!state.items.length) {
      container.innerHTML = '<div class="lx-empty">没有找到文献。<br>试试更短的关键词，或先在 LiteratureX 中导入 PDF。</div>'
      return
    }
    container.innerHTML = state.items
      .map(function (ref) {
        var authors = (ref.authors || []).slice(0, 3).join(', ')
        if ((ref.authors || []).length > 3) authors += ' et al.'
        var meta = [authors, ref.journalTitle, ref.year].filter(Boolean).join(' · ')
        var preview = formatTemplate(state.template ? state.template.inText : '[{index}]', ref, 1)
        var checked = state.selected[ref.id] ? ' checked' : ''
        return (
          '<div class="lx-item">' +
          '<input type="checkbox" data-id="' + escapeHtml(ref.id) + '"' + checked + '>' +
          '<div class="lx-item-body">' +
          '<div class="lx-item-title">' + escapeHtml(ref.title) + '</div>' +
          '<div class="lx-item-meta">' + escapeHtml(meta || '—') + '</div>' +
          '<div class="lx-item-cite" title="' + escapeHtml(preview) + '">' + escapeHtml(preview) + '</div>' +
          '</div>' +
          '</div>'
        )
      })
      .join('')
    updateFooter()
  }

  function selectedIds() {
    return Object.keys(state.selected).filter(function (id) {
      return state.selected[id]
    })
  }

  function updateFooter() {
    var count = selectedIds().length
    var selectedLabel = document.getElementById('lx-selected')
    var citedLabel = document.getElementById('lx-cited')
    var insertButton = document.getElementById('lx-insert')
    var bibButton = document.getElementById('lx-bib')
    if (selectedLabel) selectedLabel.textContent = '已选 ' + count + ' 篇'
    if (citedLabel) citedLabel.textContent = '已引用 ' + state.cited.length
    if (insertButton) insertButton.disabled = !state.canInsert || count === 0
    if (bibButton) bibButton.disabled = !state.canInsert || (count === 0 && state.cited.length === 0)
  }

  function getWpsApp() {
    if (window.Application) return window.Application
    try {
      if (window.wps && typeof window.wps.WpsApplication === 'function') return window.wps.WpsApplication()
    } catch (error) {
      return null
    }
    return null
  }

  function isWordRuntime() {
    return typeof Office !== 'undefined' && typeof Word !== 'undefined' && !!(Office.context && Office.context.document)
  }

  function wordGetCited() {
    try {
      var value = Office.context.document.settings.get(KEY)
      return value ? JSON.parse(value) : []
    } catch (error) {
      return []
    }
  }

  function wordSaveCited(ids) {
    try {
      Office.context.document.settings.set(KEY, JSON.stringify(ids))
      Office.context.document.settings.saveAsync(function () {})
    } catch (error) {
      /* document settings unavailable */
    }
  }

  function wpsGetCited() {
    var app = getWpsApp()
    var doc = app && app.ActiveDocument
    if (!doc) return []
    try {
      var variable = doc.Variables.Item(KEY)
      return variable && variable.Value ? JSON.parse(variable.Value) : []
    } catch (error) {
      return []
    }
  }

  function wpsSaveCited(ids) {
    var app = getWpsApp()
    var doc = app && app.ActiveDocument
    if (!doc) return
    try {
      try {
        doc.Variables.Item(KEY).Value = JSON.stringify(ids)
      } catch (error) {
        doc.Variables.Add(KEY, JSON.stringify(ids))
      }
    } catch (error) {
      /* document variables unavailable */
    }
  }

  function wpsGetCitations() {
    var app = getWpsApp()
    var doc = app && app.ActiveDocument
    if (!doc) return []
    try {
      var variable = doc.Variables.Item(CITATION_KEY)
      return variable && variable.Value ? JSON.parse(variable.Value) : []
    } catch (error) {
      return []
    }
  }

  function wpsSaveCitations(citations) {
    var app = getWpsApp()
    var doc = app && app.ActiveDocument
    if (!doc) return
    try {
      try {
        doc.Variables.Item(CITATION_KEY).Value = JSON.stringify(citations)
      } catch (error) {
        doc.Variables.Add(CITATION_KEY, JSON.stringify(citations))
      }
    } catch (error) {
      /* document variables unavailable */
    }
  }

  function wpsGetBibliographyBookmark() {
    var app = getWpsApp()
    var doc = app && app.ActiveDocument
    if (!doc) return null
    try {
      var variable = doc.Variables.Item(BIBLIOGRAPHY_KEY)
      return variable && variable.Value ? variable.Value : null
    } catch (error) {
      return null
    }
  }

  function wpsSaveBibliographyBookmark(name) {
    var app = getWpsApp()
    var doc = app && app.ActiveDocument
    if (!doc) return
    try {
      try {
        doc.Variables.Item(BIBLIOGRAPHY_KEY).Value = name || ''
      } catch (error) {
        doc.Variables.Add(BIBLIOGRAPHY_KEY, name || '')
      }
    } catch (error) {
      /* document variables unavailable */
    }
  }

  function loadCited() {
    if (isWordRuntime()) {
      state.cited = wordGetCited()
      return Promise.resolve()
    }
    if (getWpsApp()) {
      state.cited = wpsGetCited()
      if (!state.cited.length) {
        try {
          state.cited = JSON.parse(localStorage.getItem(KEY) || '[]')
        } catch (error) {
          state.cited = []
        }
      }
      updateFooter()
      return Promise.resolve()
    }
    try {
      state.cited = JSON.parse(localStorage.getItem(KEY) || '[]')
    } catch (error) {
      state.cited = []
    }
    updateFooter()
    return Promise.resolve()
  }

  function saveCited() {
    if (isWordRuntime()) {
      wordSaveCited(state.cited)
      return
    }
    if (getWpsApp()) wpsSaveCited(state.cited)
    try {
      localStorage.setItem(KEY, JSON.stringify(state.cited))
    } catch (error) {
      /* ignore */
    }
  }

  function insertText(text) {
    if (isWordRuntime()) {
      return Word.run(function (context) {
        var range = context.document.getSelection()
        range.insertText(text, Word.InsertLocation.end)
        return context.sync()
      })
    }
    var app = getWpsApp()
    if (!app) return Promise.reject(new Error('当前宿主不支持插入'))
    if (!app.Selection) return Promise.reject(new Error('请先在文档中放置光标'))
    app.Selection.TypeText(text)
    return Promise.resolve()
  }

  function insertTrackedCitation(text, ids) {
    var app = getWpsApp()
    if (!app || !app.Selection || !app.ActiveDocument) {
      return insertText(text + ' ').then(function () {
        return false
      })
    }
    try {
      var doc = app.ActiveDocument
      var selection = app.Selection
      var start = selection.Start
      selection.TypeText(text)
      var end = selection.End
      var name = 'LXCITE_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
      doc.Bookmarks.Add(name, doc.Range(start, end))
      state.citations.push({ bookmark: name, ids: ids.slice() })
      wpsSaveCitations(state.citations)
      selection.TypeText(' ')
      return Promise.resolve(true)
    } catch (error) {
      return insertText(text + ' ').then(function () {
        return false
      })
    }
  }

  function formatCitationGroupWithNumbers(refs, numbers) {
    var template = state.template ? state.template.inText : '[{index}]'
    var numeric =
      state.formatId === 'builtin-numeric' ||
      state.formatId === 'public-ieee' ||
      state.formatId === 'public-gbt7714'
    if (numeric) {
      var values = refs
        .map(function (ref) {
          return numbers[ref.id]
        })
        .filter(Boolean)
      return template.replace('{index}', values.join(','))
    }
    return refs
      .map(function (ref) {
        return formatTemplate(template, ref, numbers[ref.id] || 1)
      })
      .join('; ')
  }

  function refreshCitations() {
    var app = getWpsApp()
    if (!app || !app.ActiveDocument) return Promise.resolve(false)
    var doc = app.ActiveDocument
    var mapping = {}
    state.citations.forEach(function (entry) {
      if (entry && entry.bookmark && entry.ids && entry.ids.length) mapping[entry.bookmark] = entry
    })
    var found = []
    try {
      var count = doc.Bookmarks.Count
      for (var i = 1; i <= count; i += 1) {
        var bookmark = doc.Bookmarks.Item(i)
        var name = bookmark && bookmark.Name
        if (!name || name.indexOf('LXCITE_') !== 0 || !mapping[name]) continue
        found.push({ name: name, start: bookmark.Range.Start, entry: mapping[name] })
      }
    } catch (error) {
      return Promise.resolve(false)
    }
    if (!found.length) return Promise.resolve(false)
    found.sort(function (a, b) {
      return a.start - b.start
    })
    var ids = []
    found.forEach(function (citation) {
      citation.entry.ids.forEach(function (id) {
        if (ids.indexOf(id) < 0) ids.push(id)
      })
    })
    return fetchReferences(ids)
      .then(function (refs) {
        var refById = {}
        refs.forEach(function (ref) {
          refById[ref.id] = ref
        })
        var numbers = {}
        var ordered = []
        found.forEach(function (citation) {
          citation.entry.ids.forEach(function (id) {
            if (!numbers[id]) {
              numbers[id] = Object.keys(numbers).length + 1
              ordered.push(id)
            }
          })
        })
        found.forEach(function (citation) {
          var groupRefs = citation.entry.ids
            .map(function (id) {
              return refById[id]
            })
            .filter(Boolean)
          if (!groupRefs.length) return
          var text = formatCitationGroupWithNumbers(groupRefs, numbers)
          try {
            var bookmark = doc.Bookmarks.Item(citation.name)
            if (!bookmark) return
            var start = bookmark.Range.Start
            bookmark.Range.Text = text
            try {
              doc.Bookmarks.Item(citation.name).Delete()
            } catch (error) {
              /* bookmark may be removed by the text assignment */
            }
            doc.Bookmarks.Add(citation.name, doc.Range(start, start + text.length))
          } catch (error) {
            /* skip a citation that the host cannot rewrite */
          }
        })
        state.cited = ordered
        state.citations = found.map(function (citation) {
          return citation.entry
        })
        saveCited()
        wpsSaveCitations(state.citations)
        updateFooter()
        return refreshBibliography().then(function () {
          return true
        })
      })
      .catch(function () {
        return false
      })
  }

  function insertBibliographyText(entries) {
    var heading = '参考文献'
    if (isWordRuntime()) {
      return Word.run(function (context) {
        var body = context.document.body
        body.insertParagraph(heading, Word.InsertLocation.end)
        for (var i = 0; i < entries.length; i += 1) {
          body.insertParagraph(entries[i], Word.InsertLocation.end)
        }
        return context.sync()
      })
    }
    var app = getWpsApp()
    if (!app || !app.ActiveDocument) return Promise.reject(new Error('当前没有打开的文档'))
    app.ActiveDocument.Content.InsertAfter('\r' + heading + '\r' + entries.join('\r'))
    return Promise.resolve()
  }

  function insertBibliographyTracked(entries) {
    var app = getWpsApp()
    if (!app || !app.ActiveDocument) {
      return insertBibliographyText(entries).then(function () {
        return false
      })
    }
    var doc = app.ActiveDocument
    var before = doc.Content.End
    return insertBibliographyText(entries).then(function () {
      try {
        var after = doc.Content.End
        var name = 'LXBIB_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
        doc.Bookmarks.Add(name, doc.Range(before, after))
        state.bibliographyBookmark = name
        wpsSaveBibliographyBookmark(name)
        return true
      } catch (error) {
        return false
      }
    })
  }

  function refreshBibliography() {
    var app = getWpsApp()
    if (!app || !app.ActiveDocument) return Promise.resolve(false)
    var name = state.bibliographyBookmark || wpsGetBibliographyBookmark()
    if (!name) return Promise.resolve(false)
    var doc = app.ActiveDocument
    var bookmark = null
    try {
      bookmark = doc.Bookmarks.Item(name)
    } catch (error) {
      return Promise.resolve(false)
    }
    if (!bookmark) return Promise.resolve(false)
    var ids = state.cited.slice()
    if (!ids.length) return Promise.resolve(false)
    return fetchReferences(ids)
      .then(function (refs) {
        if (!refs.length) return false
        var entries = refs.map(function (ref, index) {
          return formatBibliography(ref, index + 1)
        })
        var text = '\r参考文献\r' + entries.join('\r')
        var start = bookmark.Range.Start
        bookmark.Range.Text = text
        try {
          doc.Bookmarks.Item(name).Delete()
        } catch (error) {
          /* bookmark may be removed by the text assignment */
        }
        doc.Bookmarks.Add(name, doc.Range(start, start + text.length))
        state.bibliographyBookmark = name
        wpsSaveBibliographyBookmark(name)
        return true
      })
      .catch(function () {
        return false
      })
  }

  function fallbackFormats() {
    return [
      {
        id: 'builtin-numeric',
        name: '数字 [1]',
        description: 'Numeric citations',
        inText: '[{index}]',
        bibliography: '[{index}] {authors}. {title}. {journal}, {year}, {volume}({issue}), {pages}. {doi}',
        numbered: true,
        source: 'builtin'
      },
      {
        id: 'builtin-author-year',
        name: '作者-年份',
        description: 'Author-year citations',
        inText: '({author}, {year})',
        bibliography: '{authors}. {title}. {journal}, {year}, {volume}({issue}), {pages}. {doi}',
        numbered: false,
        source: 'builtin'
      }
    ]
  }

  function loadFormats() {
    return apiGet('/api/plugin/formats')
      .then(function (data) {
        state.formats = data.formats && data.formats.length ? data.formats : fallbackFormats()
        state.publicStyleUrl = data.publicStyleUrl || state.publicStyleUrl
        var stored = null
        try {
          stored = localStorage.getItem('literaturex.formatId')
        } catch (error) {
          stored = null
        }
        if (stored) state.formatId = stored
        selectFormat(state.formatId, false)
        renderFormatOptions()
        renderFormatList()
      })
      .catch(function () {
        state.formats = fallbackFormats()
        selectFormat(state.formatId, false)
        renderFormatOptions()
        renderFormatList()
      })
  }

  function selectFormat(id, persist) {
    var format = null
    for (var i = 0; i < state.formats.length; i += 1) {
      if (state.formats[i].id === id) {
        format = state.formats[i]
        break
      }
    }
    if (!format) format = state.formats[0]
    if (!format) return
    state.formatId = format.id
    state.template = format
    if (persist !== false) {
      try {
        localStorage.setItem('literaturex.formatId', format.id)
      } catch (error) {
        /* ignore */
      }
    }
    var select = document.getElementById('lx-format')
    if (select) select.value = format.id
    syncNumberedCheckbox()
    if (persist !== false) refreshCitations()
  }

  function formatSourceLabel(source) {
    if (source === 'public') return '公开'
    if (source === 'custom') return '自定义'
    return '内置'
  }

  function renderFormatOptions() {
    var select = document.getElementById('lx-format')
    if (!select) return
    select.innerHTML = state.formats
      .map(function (format) {
        return '<option value="' + escapeHtml(format.id) + '">' + escapeHtml(format.name) + '</option>'
      })
      .join('')
    select.value = state.formatId
  }

  function renderFormatList() {
    var container = document.getElementById('lx-format-list')
    if (!container) return
    container.innerHTML = state.formats
      .map(function (format) {
        var checked = format.id === state.formatId ? ' checked' : ''
        var remove =
          format.source === 'custom'
            ? '<button type="button" class="lx-link danger" data-delete-format="' + escapeHtml(format.id) + '">删除</button>'
            : ''
        return (
          '<label class="lx-format-item" data-format-id="' + escapeHtml(format.id) + '">' +
          '<input type="radio" name="lx-format-choice" value="' + escapeHtml(format.id) + '"' + checked + '>' +
          '<span class="lx-format-body">' +
          '<span class="lx-format-name">' + escapeHtml(format.name) + '</span>' +
          '<span class="lx-format-desc">' + escapeHtml(format.description || '') + '</span>' +
          '</span>' +
          '<span class="lx-format-source">' + formatSourceLabel(format.source) + '</span>' +
          remove +
          '</label>'
        )
      })
      .join('')
    syncNumberedCheckbox()
  }

  function openPreferences() {
    var modal = document.getElementById('lx-prefs')
    if (!modal) return
    modal.hidden = false
    if (!state.formats.length) loadFormats()
    else renderFormatList()
    var input = document.getElementById('lx-example')
    if (input) input.focus()
  }

  function closePreferences() {
    var modal = document.getElementById('lx-prefs')
    if (modal) modal.hidden = true
  }

  function analyzeExample() {
    var input = document.getElementById('lx-example')
    var button = document.getElementById('lx-analyze')
    var status = document.getElementById('lx-analyze-status')
    var example = input ? input.value.trim() : ''
    if (!example) {
      toast('请先粘贴一个引用示例', true)
      return
    }
    if (status) status.textContent = 'LLM 正在分析…'
    if (button) button.disabled = true
    var language = (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    apiSend('POST', '/api/plugin/formats/analyze', { example: example, language: language })
      .then(function (data) {
        return loadFormats().then(function () {
          selectFormat(data.format.id)
          renderResults()
          renderFormatList()
          if (status) status.textContent = '已保存：' + data.format.name
          toast('格式已保存并启用')
        })
      })
      .catch(function (error) {
        if (status) status.textContent = ''
        toast(error && error.message ? error.message : '格式分析失败', true)
      })
      .then(function () {
        if (button) button.disabled = false
      })
  }

  var formatMenuKeyHandler = null

  function closeFormatMenu() {
    var menu = document.getElementById('lx-format-menu')
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu)
    if (formatMenuKeyHandler) {
      document.removeEventListener('keydown', formatMenuKeyHandler)
      formatMenuKeyHandler = null
    }
  }

  function showFormatMenu(event, id) {
    closeFormatMenu()
    var format = null
    for (var i = 0; i < state.formats.length; i += 1) {
      if (state.formats[i].id === id) {
        format = state.formats[i]
        break
      }
    }
    if (!format) return
    var menu = document.createElement('div')
    menu.id = 'lx-format-menu'
    menu.className = 'lx-context-menu'
    menu.addEventListener('mousedown', function (mouseEvent) {
      mouseEvent.stopPropagation()
    })

    var useItem = document.createElement('button')
    useItem.type = 'button'
    useItem.className = 'lx-context-item'
    useItem.textContent = '使用此格式'
    useItem.addEventListener('click', function () {
      selectFormat(format.id)
      renderResults()
      renderFormatList()
      closeFormatMenu()
    })
    menu.appendChild(useItem)

    if (format.source === 'custom') {
      var deleteItem = document.createElement('button')
      deleteItem.type = 'button'
      deleteItem.className = 'lx-context-item danger'
      deleteItem.textContent = '删除格式'
      deleteItem.addEventListener('click', function () {
        closeFormatMenu()
        deleteFormat(format.id)
      })
      menu.appendChild(deleteItem)
    }

    menu.style.left = event.clientX + 'px'
    menu.style.top = event.clientY + 'px'
    document.body.appendChild(menu)
    var rect = menu.getBoundingClientRect()
    menu.style.left = Math.max(6, Math.min(event.clientX, window.innerWidth - rect.width - 6)) + 'px'
    menu.style.top = Math.max(6, Math.min(event.clientY, window.innerHeight - rect.height - 6)) + 'px'
    formatMenuKeyHandler = function (keyEvent) {
      if (keyEvent.key === 'Escape') closeFormatMenu()
    }
    setTimeout(function () {
      document.addEventListener('mousedown', closeFormatMenu, { once: true })
      document.addEventListener('keydown', formatMenuKeyHandler)
    }, 0)
  }

  function deleteFormat(id) {
    apiSend('DELETE', '/api/plugin/formats/' + encodeURIComponent(id))
      .then(function () {
        if (state.formatId === id) state.formatId = 'builtin-numeric'
        return loadFormats().then(function () {
          renderFormatList()
          renderResults()
          toast('格式已删除')
        })
      })
      .catch(function (error) {
        toast(error && error.message ? error.message : '删除失败', true)
      })
  }

  function formatTemplate(template, ref, index) {
    var authors = (ref.authors || []).join(', ')
    var first = ref.authors && ref.authors.length ? familyName(ref.authors[0]) : ''
    var values = {
      authors: authors,
      author: first,
      year: ref.year != null ? String(ref.year) : 'n.d.',
      title: ref.title || 'Untitled',
      journal: ref.journalTitle || '',
      volume: ref.volume || '',
      issue: ref.issue || '',
      pages: ref.pages || '',
      doi: ref.doi || '',
      url: ref.url || '',
      index: String(index)
    }
    var text = String(template || '')
    Object.keys(values).forEach(function (key) {
      text = text.split('{' + key + '}').join(values[key])
    })
    return cleanupCitation(text)
  }

  function cleanupCitation(text) {
    return String(text || '')
      .replace(/\s*\(\s*\)/g, '')
      .replace(/\bvol\.\s*,/gi, '')
      .replace(/\bno\.\s*,/gi, '')
      .replace(/\bpp\.\s*,/gi, '')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/([,;:])\s*([,.;:])/g, '$2')
      .replace(/\.\s*\./g, '.')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,;:.]+|[\s,;:.]+$/g, '')
  }

  function formatNumbered(format) {
    if (!format) return false
    var override = null
    try {
      override = localStorage.getItem('literaturex.numbered.' + format.id)
    } catch (error) {
      override = null
    }
    if (override === '1') return true
    if (override === '0') return false
    if (typeof format.numbered === 'boolean') return format.numbered
    return String(format.bibliography || '').indexOf('{index}') >= 0
  }

  function syncNumberedCheckbox() {
    var checkbox = document.getElementById('lx-numbered')
    if (checkbox) checkbox.checked = formatNumbered(state.template)
  }

  function formatBibliography(ref, index) {
    var template = state.template ? state.template.bibliography : fallbackFormats()[0].bibliography
    if (formatNumbered(state.template) && template.indexOf('{index}') < 0) {
      template = '[{index}] ' + template
    }
    return formatTemplate(template, ref, index)
  }

  function formatCitationGroup(refs) {
    var template = state.template ? state.template.inText : '[{index}]'
    var numeric = state.formatId === 'builtin-numeric' || state.formatId === 'public-ieee' || state.formatId === 'public-gbt7714'
    if (numeric) {
      var numbers = refs.map(function (ref) {
        return state.cited.indexOf(ref.id) + 1
      })
      return template.replace('{index}', numbers.join(','))
    }
    return refs
      .map(function (ref, index) {
        return formatTemplate(template, ref, state.cited.indexOf(ref.id) + 1 || index + 1)
      })
      .join('; ')
  }

  function fetchReferences(ids) {
    return apiGet('/api/plugin/references?ids=' + encodeURIComponent(ids.join(','))).then(function (data) {
      return data.items || []
    })
  }

  function insertCitation() {
    var ids = selectedIds()
    if (!ids.length) return
    loadCited().then(function () {
      var added = []
      ids.forEach(function (id) {
        if (state.cited.indexOf(id) < 0) {
          state.cited.push(id)
          added.push(id)
        }
      })
      saveCited()
      return fetchReferences(ids).then(function (refs) {
        var text = formatCitationGroup(refs)
        return insertTrackedCitation(text, ids).then(function (tracked) {
          return (tracked ? refreshCitations() : Promise.resolve(false)).then(function () {
            updateFooter()
            toast('已插入引用 ' + text)
          })
        })
      })
    }).catch(function (error) {
      toast(error && error.message ? error.message : '插入失败', true)
    })
  }

  function insertNewBibliography() {
    var ids = state.cited.slice()
    if (!ids.length) ids = selectedIds()
    if (!ids.length) {
      toast('请先插入引用或选择文献', true)
      return Promise.resolve()
    }
    if (!state.cited.length) {
      state.cited = ids.slice()
      saveCited()
    }
    return fetchReferences(ids).then(function (refs) {
      var entries = refs.map(function (ref, index) {
        return formatBibliography(ref, index + 1)
      })
      return insertBibliographyTracked(entries).then(function (tracked) {
        updateFooter()
        toast(tracked ? '已插入参考文献表（可通过刷新更新）' : '已插入参考文献表（' + entries.length + ' 条）')
      })
    })
  }

  function insertBibliography() {
    loadCited()
      .then(function () {
        var existing = state.bibliographyBookmark || wpsGetBibliographyBookmark()
        if (existing) {
          return refreshBibliography().then(function (refreshed) {
            if (refreshed) {
              updateFooter()
              toast('参考文献表已刷新')
              return
            }
            return insertNewBibliography()
          })
        }
        return insertNewBibliography()
      })
      .catch(function (error) {
        toast(error && error.message ? error.message : '插入参考文献表失败', true)
      })
  }

  function exportBibliography() {
    loadCited()
      .then(function () {
        var ids = state.cited.length ? state.cited.slice() : selectedIds()
        if (!ids.length) {
          toast('请先选择文献或插入引用', true)
          return
        }
        return fetchReferences(ids).then(function (refs) {
          var text = refs
            .map(function (ref, index) {
              return formatBibliography(ref, index + 1)
            })
            .join('\n')
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () {
              toast('参考文献已复制到剪贴板（' + refs.length + ' 条）')
            })
          }
          toast('当前环境不支持剪贴板导出', true)
        })
      })
      .catch(function (error) {
        toast(error && error.message ? error.message : '导出失败', true)
      })
  }

  function currentMode() {
    try {
      var params = new URLSearchParams(window.location.search)
      var mode = params.get('mode')
      if (mode) return mode
    } catch (error) {
      /* URLSearchParams may be unavailable in older hosts */
    }
    try {
      var app = getWpsApp()
      if (app && app.PluginStorage) {
        var stored = app.PluginStorage.getItem('literaturex_mode')
        if (stored) return stored
      }
    } catch (error) {
      /* PluginStorage is optional */
    }
    return ''
  }

  function applyMode() {
    var mode = currentMode()
    var search = document.getElementById('lx-search')
    if (mode === 'bibliography') {
      if (state.cited.length || selectedIds().length) {
        insertBibliography()
        return
      }
      var bibButton = document.getElementById('lx-bib')
      if (bibButton) bibButton.focus()
      toast('勾选文献后点击“参考文献表”插入。')
      return
    }
    if (mode === 'refresh') {
      refreshStatus()
      doSearch(document.getElementById('lx-search').value)
      refreshCitations().then(function (refreshed) {
        toast(refreshed ? '引用与参考文献已刷新' : '已刷新文献库连接')
      })
      return
    }
    if (mode === 'preferences') {
      openPreferences()
      return
    }
    if (mode === 'export') {
      exportBibliography()
      return
    }
    if (mode === 'note') {
      toast('请在 LiteratureX 桌面端为文献添加阅读笔记。')
      return
    }
    if (mode === 'about') {
      toast('LiteratureX 参考文献插件 v' + (cfg.version || '0.1.0'))
      return
    }
    if (search) {
      search.focus()
      if (search.select) search.select()
    }
  }

  function startHost() {
    if (state.started) return
    state.started = true
    if (isWordRuntime()) {
      state.host = 'Microsoft Word'
      state.canInsert = true
      refreshStatus()
      Promise.all([doSearch(''), loadCited(), loadFormats()]).then(function () {
        updateFooter()
        applyMode()
      })
      return
    }
    var app = getWpsApp()
    if (app) {
      state.host = 'WPS Writer'
      state.canInsert = true
      refreshStatus()
      Promise.all([doSearch(''), loadCited(), loadFormats()]).then(function () {
        state.citations = wpsGetCitations()
        state.bibliographyBookmark = wpsGetBibliographyBookmark()
        updateFooter()
        applyMode()
      })
      return
    }
    state.host = '预览模式'
    state.canInsert = false
    refreshStatus()
    Promise.all([doSearch(''), loadCited(), loadFormats()]).then(function () {
      updateFooter()
      applyMode()
    })
  }

  function tryWps(attempt) {
    if (getWpsApp()) {
      startHost()
      return
    }
    if (attempt > 20) {
      startHost()
      return
    }
    setTimeout(function () {
      tryWps(attempt + 1)
    }, 100)
  }

  renderShell()

  if (typeof Office !== 'undefined' && typeof Office.onReady === 'function') {
    Office.onReady(function () {
      startHost()
    })
    setTimeout(function () {
      if (!state.connected && !state.items.length) startHost()
    }, 4000)
  } else {
    tryWps(0)
  }
})()
