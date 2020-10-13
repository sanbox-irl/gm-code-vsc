# CHANGELOG

All notable changes to this project will be documented in this file.

## [0.2.1] - 2020-10-13

### Fixes

- Fixed a problem with Tasks on a Bash in Windows.

## [0.2.0] - 2020-10-12

Added various new features and bugfixes.

**Breaking change**: this extension now requires Visual Studio Code version 1.50.

Additionally, *adam*, the tool used to compile Gms2 projects, only works on the most recent, stable release
of Gms2. The Gms2 Beta channel is not currently supported. PRs are welcome!

### Fixes

- Fixed crashes on yy-boss parsing objects
- Fixed pipe overflow errors
- Various other minor bugfixes
- Fixed our logging, which wasn't actually going to users at all.

### Added

- Adam, a build tool for Gms2
- add types for all non-script files
- Nicer icons
- Shader support
- All event support
- Created *this* changelog
- Created a basic user guide

## [0.1.0] - 2020-09-14

This is the initial release of gm-code-vsc.

### Added

- Created Asset Browser, including:
  - Folders
  - Scripts
  - Objects
  - Events
- Created basic logging
- Download yy-boss simply.
- Basic set up for the extension (readme, some docs, etc)
