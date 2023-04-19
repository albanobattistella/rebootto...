/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const { Gio, Clutter, St, Pango } = imports.gi;
const Main = imports.ui.main;
const { panel } = Main;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Util = imports.misc.util;
const ModalDialog = imports.ui.modalDialog;

const Config = imports.misc.config;
const [major] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

const Gettext = imports.gettext;
const Domain = Gettext.domain(Me.metadata.uuid);
const _ = Domain.gettext;

const ManagerInterface = `<node>
  <interface name="org.freedesktop.login1.Manager">
    <property name="BootLoaderEntries" type="as" access="read"/>
    <method name="SetRebootToBootLoaderEntry">
      <arg type="s" direction="in"/>
    </method>
    <method name="Reboot">
      <arg type="b" direction="in"/>
    </method>
  </interface>
</node>`;
const Manager = Gio.DBusProxy.makeProxyWrapper(ManagerInterface);

class Extension {
  menu
  proxy;
  rebootToEntryItems;
  selectedEntry;
  prettyNames;
  /** @type {number} */
  counter;
  /** @type {number} */
  seconds;
  /** @type {number} */
  counterIntervalId;
  /** @type {number} */
  messageIntervalId;
  /** @type {boolean} */
  isPreQuickSettings;

  constructor() {
    this.isPreQuickSettings = !this._checkQuickSettingsSupport();
    this.menu = this.isPreQuickSettings
      ? panel.statusArea.aggregateMenu._system._sessionSubMenu.menu
      : panel.statusArea.quickSettings._system.quickSettingsItems[0].menu;
  }

  enable() {
    this.proxy = new Manager(Gio.DBus.system, 'org.freedesktop.login1', '/org/freedesktop/login1');

    let entries = this.proxy.BootLoaderEntries;

    /*
      prettyNames.set('Pop_OS-current.conf', 'Pop!_OS');
      prettyNames.set('Pop_OS-recovery.conf', 'Pop!_OS Recovery');
      prettyNames.set('Pop_OS-rescue.conf', 'Pop!_OS Rescue');
      prettyNames.set('auto-windows', 'Windows');
      prettyNames.set('auto-reboot-to-firmware-setup', 'Firmware Setup');
        for Pop_OS-current.conf,Pop_OS-recovery.conf,Pop_OS-rescue.conf,auto-windows,auto-reboot-to-firmware-setup
    */
    
    this.prettyNames = new Map();

    // log(`Found ${entries.length} entries for reboot: [${entries.join(', ')}]`);
    this.rebootToEntryItems = new Array(entries.length);

    entries.forEach((entry, index) => {
      let prettyName = entry.replace(/\.conf$/, '').replace(/auto-reboot-to-firmware-setup/, 'UEFI').replace(/auto-/, '').replace(/-/, ' ');
      prettyName = prettyName.charAt(0).toUpperCase() + prettyName.slice(1);
      this.prettyNames.set(entry, prettyName);

      const item = new PopupMenu.PopupMenuItem(`${_('Restart to %s').replace('%s', prettyName)}...`);
      
      item.connect('activate', () => {
        this.counter = 60;
        this.seconds = this.counter;
        this.selectedEntry = entry;

        log(`selected "${this.selectedEntry}" entry for reboot`);
  
        const dialog = this._buildDialog();
        dialog.open();
  
        this.counterIntervalId = setInterval(() => {
          if (this.counter > 0) {
            this.counter--;
            if (this.counter % 10 === 0) {
              this.seconds = this.counter;
            }
          } else {
            this._clearIntervals();
            this._reboot();
          }
        }, 1000);
  
      });

      this.menu.addMenuItem(item, 2+index);
      this.rebootToEntryItems[index] = item;
    });
    
  }

  disable() {
    this.rebootToEntryItems.forEach((entry) => entry.destroy());
    this.rebootToEntryItems = null;
    this.proxy = null;
  }

  /** @returns {boolean} */
  _checkQuickSettingsSupport() {
    return major >= 43;
  }

  _reboot() {
    log(`rebooting to ${this.selectedEntry}`)
    this.proxy.SetRebootToBootLoaderEntryRemote(this.selectedEntry);
    this.proxy.RebootRemote(false);
  }

  _buildDialog() {
    const dialog = new ModalDialog.ModalDialog({styleClass: "modal-dialog"});
    dialog.setButtons([
      {
        label: _("Cancel"),
        action: () => {
          this._clearIntervals();
          dialog.close();
        },
        key: Clutter.KEY_Escape,
        default: false,
      },
      {
        label: _("Restart"),
        action: () => {
          this._clearIntervals();
          this._reboot();
        },
        default: false,
      },
    ]);

    const dialogTitle = new St.Label({
      text: _('Restart to %s').replace('%s', this.prettyNames.get(this.selectedEntry)),
      // style_class: 'dialog-title' // TODO investigate why css classes are not working
      style: "font-weight: bold;font-size:18px"
    });

    let dialogMessage = new St.Label({
      text: this._getDialogMessageText(),
    });
    dialogMessage.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    dialogMessage.clutter_text.line_wrap = true;

    const titleBox = new St.BoxLayout({
      x_align: Clutter.ActorAlign.CENTER,
    });
    titleBox.add(new St.Label({ text: '  ' }));
    titleBox.add(dialogTitle);

    let box = new St.BoxLayout({ y_expand: true, vertical: true });
    box.add(titleBox);
    box.add(new St.Label({ text: '  ' }));
    box.add(dialogMessage);

    this.messageIntervalId = setInterval(() => {
      dialogMessage?.set_text(this._getDialogMessageText());
    }, 500);

    dialog.contentLayout.add(box);

    return dialog;
  }

  _getDialogMessageText() {
    return _(`The system will restart automatically in %d seconds.`).replace('%d', this.seconds);
  }

  _clearIntervals() {
    clearInterval(this.counterIntervalId);
    clearInterval(this.messageIntervalId);
  }

}

function init() {
    ExtensionUtils.initTranslations(Me.metadata.uuid);
    return new Extension();
}
