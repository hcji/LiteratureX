// WPS Writer ribbon callbacks. This file runs inside the WPS add-in host.
var LX_RIBBON_IMAGES = {
  btnAddEditCitation: 'images/citation.svg',
  btnAddEditBib: 'images/bibliography.svg',
  btnRefresh: 'images/refresh.svg',
  btnPref: 'images/preferences.svg',
  btnAddNote: 'images/note.svg',
  btnUnlink: 'images/unlink.svg',
  btnExport: 'images/export.svg',
  btnAbout: 'images/about.svg'
};

function GetUrlPath() {
  var value = decodeURI(document.location.toString());
  if (value.indexOf('/') >= 0) value = value.substring(0, value.lastIndexOf('/'));
  return value;
}

function OnAddinLoad(ribbonUI) {
  try {
    window.Application.ribbonUI = ribbonUI;
  } catch (error) {
    /* ribbonUI is optional for the task pane flow */
  }
  return true;
}

function GetImage(control) {
  var id = control && control.Id ? control.Id : '';
  return LX_RIBBON_IMAGES[id] || 'images/citation.svg';
}

function TaskPaneUrl(mode) {
  var url = GetUrlPath() + '/ui/taskpane.html';
  if (mode) url += '?mode=' + encodeURIComponent(mode);
  return url;
}

function RememberMode(mode) {
  try {
    window.Application.PluginStorage.setItem('literaturex_mode', mode || 'citation');
  } catch (error) {
    /* PluginStorage is optional */
  }
}

function OpenLiteratureXTaskPane(mode) {
  var app = window.Application;
  if (!app) {
    alert('WPS 加载项尚未就绪，请重启 WPS 后再试。');
    return;
  }
  var url = TaskPaneUrl(mode);
  RememberMode(mode);
  try {
    var existingId = app.PluginStorage.getItem('literaturex_taskpane_id');
    if (existingId) {
      var existing = app.GetTaskPane(existingId);
      if (existing) {
        try {
          if (typeof existing.Navigate === 'function') existing.Navigate(url);
        } catch (error) {
          /* older WPS builds do not expose Navigate */
        }
        existing.Visible = true;
        return;
      }
    }
    var pane = app.CreateTaskPane(url);
    app.PluginStorage.setItem('literaturex_taskpane_id', pane.ID);
    pane.Visible = true;
    try {
      if (app.Enum && app.Enum.msoCTPDockPositionRight != null) {
        pane.DockPosition = app.Enum.msoCTPDockPositionRight;
      }
    } catch (error) {
      /* docking is best effort */
    }
  } catch (error) {
    alert('无法打开 LiteratureX 任务窗格：' + (error && error.message ? error.message : error));
  }
}

function OnAction(control) {
  var id = control && control.Id ? control.Id : '';
  switch (id) {
    case 'btnAddEditCitation':
    case 'btnLiteratureXCitation':
    case 'btnLiteratureXInsert':
      OpenLiteratureXTaskPane('citation');
      break;
    case 'btnAddEditBib':
      OpenLiteratureXTaskPane('bibliography');
      break;
    case 'btnRefresh':
      OpenLiteratureXTaskPane('refresh');
      break;
    case 'btnPref':
      OpenLiteratureXTaskPane('preferences');
      break;
    case 'btnAddNote':
      OpenLiteratureXTaskPane('note');
      break;
    case 'btnExport':
      OpenLiteratureXTaskPane('export');
      break;
    case 'btnUnlink':
      alert('文献引用以纯文本插入，当前文档没有需要解除的字段代码。');
      break;
    case 'btnAbout':
      OpenLiteratureXTaskPane('about');
      break;
    default:
      break;
  }
  return true;
}
