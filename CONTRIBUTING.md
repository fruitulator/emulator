# Contributing to Fruitulator

Fruitulator is meant to be a community project: fixes, new boards, better
rendering, and help for machines that do not play right yet are all
welcome. This page says how to send them.

## Before you start

* **Sign the CLA.** The first time you open a pull request, a check asks
  you to agree to the [Contributor Licence Agreement](CLA.md) by posting
  one sentence as a comment. It takes a minute and covers all your future
  pull requests.
* **No games, ever.** Fruitulator is bring-your-own-ROM. A pull request
  must never include, link to or name a ROM, a ROM set, a layout or a game
  file, and that includes code comments, test names and commit messages.
  Describe a machine by its board and what it does, not by its title.
* **Say where things come from.** Emulation code here is built from
  manufacturers' datasheets and manuals, MAME and similar sources. If your
  change is based on one, say which in the pull request. Do not paste in
  code from another project unless its licence allows it, and say so if
  you do.
* **For anything large, open an issue first,** so we can agree the
  approach before you spend the time.

## Making a change

1. Fork the repository and make a branch from `main`.
2. Make your change, then check it builds:

   ```sh
   npm ci
   npm run typecheck
   npm run build
   ```

3. Try it in the browser (`npm run dev`) with a machine of your own that
   the change affects, and say in the pull request which board you tested
   on and what you saw.
4. Open a pull request against `main`. Describe what was wrong, what you
   changed and how you checked it. Screenshots or a short recording help
   a lot for anything you can see.

## What happens next

The maintainer reviews every pull request. Fruitulator is developed in a
separate working repository, so an accepted change is applied there and
reaches this repository with the next release, credited to you, rather
than being merged here directly. It may be adjusted on the way in; if it
changes much, you will be told why.

## Reporting a problem

Open an issue. Say which board the machine runs on, what you expected and
what happened, and include the Diagnostics Log from the app's menu if you
can. Please do not name the game or attach any of its files.
