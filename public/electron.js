const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  Menu,
  dialog,
  // eslint-disable-next-line import/no-extraneous-dependencies
} = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const fs = require('fs');
const isOnline = require('is-online');
const fse = require('fs-extra');
const electronDl = require('electron-dl');
const extract = require('extract-zip');
const archiver = require('archiver');
const { ncp } = require('ncp');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const {
  DELETE_SPACE_CHANNEL,
  DELETED_SPACE_CHANNEL,
  EXPORT_SPACE_CHANNEL,
  EXPORTED_SPACE_CHANNEL,
  GET_SPACE_CHANNEL,
  GET_SPACES_CHANNEL,
  LOAD_SPACE_CHANNEL,
  LOADED_SPACE_CHANNEL,
  MESSAGE_DIALOG_RESPOND_CHANNEL,
  SAVE_DIALOG_PATH_SELECTED_CHANNEL,
  SHOW_MESSAGE_DIALOG_CHANNEL,
  SHOW_SAVE_DIALOG_CHANNEL,
  SHOW_OPEN_DIALOG_CHANNEL,
  OPEN_DIALOG_PATHS_SELECTED_CHANNEL,
} = require('./channels');
const { getExtension } = require('./utilities');

const { download } = electronDl;
const fsPromises = fs.promises;
let mainWindow;

const savedSpacesPath = `${app.getPath('userData')}/.meta`;
const spacesFileName = 'spaces.json';
const ERROR_ZIP_CORRUPTED = 'ERROR_ZIP_CORRUPTED';
const ERROR_JSON_CORRUPTED = 'ERROR_JSON_CORRUPTED';
const ERROR_SPACE_ALREADY_AVAILABLE = 'ERROR_SPACE_ALREADY_AVAILABLE';
const ERROR_GENERAL = 'ERROR_GENERAL';

const createWindow = () => {
  mainWindow = new BrowserWindow({
    backgroundColor: '#F7F7F7',
    minWidth: 880,
    show: false,
    movable: true,
    webPreferences: {
      nodeIntegration: false,
      preload: `${__dirname}/preload.js`,
      webSecurity: false,
    },
    height: 860,
    width: 1280,
  });

  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );

  if (isDev) {
    const {
      default: installExtension,
      REACT_DEVELOPER_TOOLS,
      REDUX_DEVTOOLS,
      // eslint-disable-next-line global-require
    } = require('electron-devtools-installer');

    installExtension(REACT_DEVELOPER_TOOLS)
      .then(name => {
        log.info(`added extension: ${name}`);
      })
      .catch(err => {
        log.error(err);
      });

    installExtension(REDUX_DEVTOOLS)
      .then(name => {
        log.info(`added extension: ${name}`);
      })
      .catch(err => {
        log.error(err);
      });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    ipcMain.on('open-external-window', (event, arg) => {
      shell.openExternal(arg);
    });
  });
};

// const handleLoad = () => {
//   log.info('load');
// };

const generateMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        // {
        //   label: 'Load Space',
        //   click() {
        //     handleLoad();
        //   },
        // },
        {
          label: 'About',
          role: 'about',
        },
        {
          label: 'Quit',
          role: 'quit',
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteandmatchstyle' },
        { role: 'delete' },
        { role: 'selectall' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      role: 'help',
      submenu: [
        {
          click() {
            // eslint-disable-next-line
            require('electron').shell.openExternal(
              'https://github.com/react-epfl/graasp-desktop/blob/master/README.md'
            );
          },
          label: 'Learn More',
        },
        {
          click() {
            // eslint-disable-next-line
            require('electron').shell.openExternal(
              'https://github.com/react-epfl/graasp-desktop/issues'
            );
          },
          label: 'File Issue on GitHub',
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const checkFileAvailable = filePath =>
  new Promise(resolve =>
    fs.access(filePath, fs.constants.F_OK, err => resolve(!err))
  );

app.on('ready', () => {
  // updater
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.checkForUpdatesAndNotify();

  createWindow();
  generateMenu();
  ipcMain.on(GET_SPACE_CHANNEL, async (event, { id, spaces }) => {
    try {
      const space = spaces.find(el => Number(el.id) === Number(id));
      const { phases } = space;
      // eslint-disable-next-line no-restricted-syntax
      for (const phase of phases) {
        const { items = [] } = phase;
        for (let i = 0; i < items.length; i += 1) {
          const { resource } = items[i];
          if (resource) {
            const { uri, hash, type } = resource;
            const fileName = `${hash}.${type}`;
            const filePath = `${savedSpacesPath}/${fileName}`;
            // eslint-disable-next-line no-await-in-loop
            const fileAvailable = await checkFileAvailable(filePath);
            if (fileAvailable) {
              phase.items[i].asset = filePath;
            } else {
              // eslint-disable-next-line no-await-in-loop
              const isConnected = await isOnline();
              if (isConnected) {
                // eslint-disable-next-line no-await-in-loop
                await download(mainWindow, uri, {
                  directory: savedSpacesPath,
                  filename: fileName,
                }).then(dl => {
                  phase.items[i].asset = dl.getSavePath();
                });
              } else {
                mainWindow.webContents.send(GET_SPACE_CHANNEL, ERROR_GENERAL);
              }
            }
          }
        }
      }
      mainWindow.webContents.send(GET_SPACE_CHANNEL, space);
    } catch (err) {
      log.error(err);
    }
  });
  ipcMain.on(GET_SPACES_CHANNEL, async () => {
    try {
      let spaces = [];
      const spacesPath = `${savedSpacesPath}/${spacesFileName}`;
      fs.readFile(spacesPath, 'utf8', async (err, data) => {
        // we dont have saved spaces yet
        if (err) {
          mainWindow.webContents.send(GET_SPACES_CHANNEL, spaces);
        } else {
          spaces = JSON.parse(data);
          // eslint-disable-next-line no-restricted-syntax
          for (const space of spaces) {
            const { image: imageUrl, id } = space;
            if (imageUrl) {
              const extension = getExtension(imageUrl);
              const backgroundImage = `background-${id}.${extension}`;
              const backgroundImagePath = `${savedSpacesPath}/${backgroundImage}`;
              // eslint-disable-next-line no-await-in-loop
              const backgroundImageExists = await checkFileAvailable(
                backgroundImagePath
              );
              if (backgroundImageExists) {
                space.asset = `file://${backgroundImagePath}`;
              } else {
                // eslint-disable-next-line no-await-in-loop
                const isConnected = await isOnline();
                if (isConnected) {
                  // eslint-disable-next-line no-await-in-loop
                  await download(mainWindow, imageUrl, {
                    directory: savedSpacesPath,
                    filename: backgroundImage,
                  })
                    .then(dl => {
                      space.asset = `file://${dl.getSavePath()}`;
                    })
                    .catch(e => log.error(e));
                }
              }
            }
          }
          mainWindow.webContents.send(GET_SPACES_CHANNEL, spaces);
        }
      });
    } catch (e) {
      log.error(e);
    }
  });
  ipcMain.on(DELETE_SPACE_CHANNEL, async (event, { id }) => {
    try {
      let spaces = [];
      let spaceImageUrl = '';
      const spacesPath = `${savedSpacesPath}/${spacesFileName}`;
      fs.readFile(spacesPath, 'utf8', async (err, data) => {
        if (err) {
          mainWindow.webContents.send(DELETED_SPACE_CHANNEL, ERROR_GENERAL);
        } else {
          spaces = JSON.parse(data);
          const allResources = [];
          const spaceResources = [];

          // eslint-disable-next-line no-restricted-syntax
          for (const space of spaces) {
            const { phases, id: spaceId, image: imageUrl } = space;
            if (spaceId === id) {
              // to get the extension of the background image for the space to be deleted
              spaceImageUrl = imageUrl;
            }
            // eslint-disable-next-line no-restricted-syntax
            for (const phase of phases) {
              const { items = [] } = phase;
              for (let i = 0; i < items.length; i += 1) {
                const { resource } = items[i];
                if (resource) {
                  const { hash, type } = resource;
                  const fileName = `${hash}.${type}`;
                  const filePath = `${savedSpacesPath}/${fileName}`;
                  // eslint-disable-next-line no-await-in-loop
                  const fileAvailable = await checkFileAvailable(filePath);
                  if (fileAvailable) {
                    if (spaceId === id) {
                      spaceResources.push(filePath);
                    } else {
                      allResources.push(filePath);
                    }
                  }
                }
              }
            }
          }
          // resources in the space but not used by other spaces
          const allResourcesSet = new Set(allResources);
          const spaceDistinctResources = new Set(
            [...spaceResources].filter(
              filePath => !allResourcesSet.has(filePath)
            )
          );
          const extension = spaceImageUrl.match(/[^\\]*\.(\w+)$/)[1];
          const backgroundImagePath = `${savedSpacesPath}/background-${id}.${extension}`;
          const backgroundImageExists = await checkFileAvailable(
            backgroundImagePath
          );
          if (backgroundImageExists) {
            spaceDistinctResources.add(backgroundImagePath);
          }
          // delete all resources used by the space to be deleted only
          [...spaceDistinctResources].forEach(filePath =>
            fs.unlink(filePath, error => {
              if (error) {
                log.error(error);
              }
            })
          );
          const newSpaces = spaces.filter(el => Number(el.id) !== Number(id));
          const spacesString = JSON.stringify(newSpaces);
          await fsPromises.writeFile(
            `${savedSpacesPath}/${spacesFileName}`,
            spacesString
          );
          mainWindow.webContents.send(DELETED_SPACE_CHANNEL);
        }
      });
    } catch {
      mainWindow.webContents.send(DELETED_SPACE_CHANNEL, ERROR_GENERAL);
    }
  });
  ipcMain.on(LOAD_SPACE_CHANNEL, async (event, { fileLocation }) => {
    try {
      const extractPath = `${savedSpacesPath}/temp/`;
      extract(fileLocation, { dir: extractPath }, async err => {
        if (err) {
          log.error(err);
        } else {
          let space = {};
          const spacePath = `${extractPath}/space.json`;
          fs.readFile(spacePath, 'utf8', async (error, data) => {
            if (error) {
              mainWindow.webContents.send(
                LOADED_SPACE_CHANNEL,
                ERROR_ZIP_CORRUPTED
              );
              fse.remove(extractPath, removeError => {
                if (removeError) {
                  log.error(removeError);
                }
              });
            } else {
              ncp(extractPath, savedSpacesPath, async ncpError => {
                if (ncpError) {
                  return log.error(ncpError);
                }
                let spaces = [];
                space = JSON.parse(data);
                const spacesPath = `${savedSpacesPath}/${spacesFileName}`;
                return fs.readFile(
                  spacesPath,
                  'utf8',
                  async (readError, spacesData) => {
                    // we dont have saved spaces yet
                    if (readError) {
                      spaces.push(space);
                      const spacesString = JSON.stringify(spaces);
                      await fsPromises.writeFile(
                        `${savedSpacesPath}/${spacesFileName}`,
                        spacesString
                      );
                      mainWindow.webContents.send(LOADED_SPACE_CHANNEL, spaces);
                    } else {
                      try {
                        spaces = JSON.parse(spacesData);
                      } catch (e) {
                        mainWindow.webContents.send(
                          LOADED_SPACE_CHANNEL,
                          ERROR_JSON_CORRUPTED
                        );
                      }
                      const spaceId = Number(space.id);
                      const available = spaces.find(
                        ({ id }) => Number(id) === spaceId
                      );
                      if (!available) {
                        spaces.push(space);
                        const spacesString = JSON.stringify(spaces);
                        await fsPromises.writeFile(
                          `${savedSpacesPath}/${spacesFileName}`,
                          spacesString
                        );
                        mainWindow.webContents.send(
                          LOADED_SPACE_CHANNEL,
                          spaces
                        );
                      } else {
                        mainWindow.webContents.send(
                          LOADED_SPACE_CHANNEL,
                          ERROR_SPACE_ALREADY_AVAILABLE
                        );
                      }
                    }
                    fs.unlink(`${savedSpacesPath}/space.json`, unlinkError => {
                      if (unlinkError) {
                        log.error(unlinkError);
                      }
                    });
                    fse.remove(extractPath, removeError => {
                      if (removeError) {
                        log.error(removeError);
                      }
                    });
                  }
                );
              });
            }
          });
        }
      });
    } catch (err) {
      log.error(err);
    }
  });
  ipcMain.on(
    EXPORT_SPACE_CHANNEL,
    async (event, { archivePath, id, spaces }) => {
      try {
        const space = spaces.find(el => Number(el.id) === Number(id));
        const { phases, image: imageUrl } = space;
        const spacesString = JSON.stringify(space);
        const ssPath = `${savedSpacesPath}/space.json`;
        const filesPaths = [ssPath];
        if (imageUrl) {
          // regex to get file extension
          const extension = getExtension(imageUrl);
          const backgroundImage = `background-${id}.${extension}`;
          const backgroundImagePath = `${savedSpacesPath}/${backgroundImage}`;
          const backgroundImageExists = await checkFileAvailable(
            backgroundImagePath
          );
          if (backgroundImageExists) {
            filesPaths.push(backgroundImagePath);
          }
        }
        await fsPromises.writeFile(ssPath, spacesString);
        // eslint-disable-next-line no-restricted-syntax
        for (const phase of phases) {
          const { items = [] } = phase;
          for (let i = 0; i < items.length; i += 1) {
            const { resource } = items[i];
            if (resource) {
              const { hash, type } = resource;
              const fileName = `${hash}.${type}`;
              const filePath = `${savedSpacesPath}/${fileName}`;
              // eslint-disable-next-line no-await-in-loop
              const fileAvailable = await checkFileAvailable(filePath);
              if (fileAvailable) {
                filesPaths.push(filePath);
              }
            }
          }
        }
        const output = fs.createWriteStream(archivePath);
        const archive = archiver('zip', {
          zlib: { level: 9 },
        });
        output.on('close', () => {
          fs.unlink(ssPath, err => {
            if (err) {
              log.error(err);
            }
          });
          mainWindow.webContents.send(EXPORTED_SPACE_CHANNEL);
        });
        output.on('end', () => {
          mainWindow.webContents.send(EXPORTED_SPACE_CHANNEL, ERROR_GENERAL);
        });
        archive.on('warning', err => {
          if (err.code === 'ENOENT') {
            log.error(err);
          }
        });
        archive.on('error', () => {
          mainWindow.webContents.send(EXPORTED_SPACE_CHANNEL, ERROR_GENERAL);
        });
        archive.pipe(output);
        filesPaths.forEach(filePath => {
          const pathArr = filePath.split('/');
          archive.file(filePath, { name: pathArr[pathArr.length - 1] });
        });
        archive.finalize();
      } catch (err) {
        log.error(err);
        mainWindow.webContents.send(EXPORTED_SPACE_CHANNEL, ERROR_GENERAL);
      }
    }
  );
  ipcMain.on(SHOW_OPEN_DIALOG_CHANNEL, (event, options) => {
    dialog.showOpenDialog(null, options, filePaths => {
      mainWindow.webContents.send(
        OPEN_DIALOG_PATHS_SELECTED_CHANNEL,
        filePaths
      );
    });
  });
  ipcMain.on(SHOW_SAVE_DIALOG_CHANNEL, (event, spaceTitle) => {
    const options = {
      title: 'Save As',
      defaultPath: `${spaceTitle}.zip`,
    };
    dialog.showSaveDialog(null, options, filePath => {
      mainWindow.webContents.send(SAVE_DIALOG_PATH_SELECTED_CHANNEL, filePath);
    });
  });
  ipcMain.on(SHOW_MESSAGE_DIALOG_CHANNEL, () => {
    const options = {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      message: 'Are you sure you want to delete this space?',
    };
    dialog.showMessageBox(null, options, respond => {
      mainWindow.webContents.send(MESSAGE_DIALOG_RESPOND_CHANNEL, respond);
    });
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.on('load-page', (event, arg) => {
  mainWindow.loadURL(arg);
});
