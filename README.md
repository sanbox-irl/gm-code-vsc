# gm-code-vsc

This is a *highly* alpha Gms2 extension for Visual Studio Code. It provides support to show the Asset Browser in Visual Studio Code.

**Note: only the most recent STABLE version of Gms2 is supported.**

If you're a *user*, please read the [getting started guide here](./docs/getting_started.md) for an introduction to the various features gm-code-vsc provides.

## Status

This extension is under active development. The current goals for 0.3.0 are:

- TextMate grammer for excellent Gms2 colorization
- Intellisense for built in Gms2 functions
- Intellisense for resources within a project
- Function lookups

For more details, make sure to checkout the [ROADMAP](./ROADMAP.md).

## Features

- View your Gms2 Asset Tree in Visual Studio Code
  ![TreeView](./images/wow.gif)

- Simply click on any code file (script, object event, shader) to open the text file to edit.
- Add and Delete Scripts, Objects, and Events by simply right clicking in the Asset Browser, just like in Gms2
  ![EditView](./images/edittree.png)

- Compile Gms2 using *adam*, a command-line Gms2 compiler invoker, which you can get separately [here](https://github.com/NPC-Studio/adam).
