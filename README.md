# Fruitulator

Fruitulator is a fruit machine emulator that runs in a web browser. It plays
UK fruit machines from their original program ROMs, laid out with the
layout files made for MFME, on a desktop or a phone.

## Bring your own games

Fruitulator does not include any games, ROMs or layouts, and this repository
does not link to any. To play, you load your own: a folder or archive holding
a machine's ROMs and its layout files (`.fml` or `.dat`, with its `.gam`).

## Building it

You need Node.js 22 or later.

```sh
npm ci
npm run dev      # a local server with live reload
npm run build    # a production build in dist/
```

## Contributing

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first:
contributors sign a short [Contributor Licence Agreement](CLA.md), and no
pull request may include or name any game, ROM or layout.

## Licence

GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later);
see [LICENSE](LICENSE). If you change Fruitulator and share it, or run your
changed copy as a website, you must publish your source under the same
licence. Releases before 13 October 2026 were published under the BSD
3-Clause License and those copies stay under it.

Parts of the emulation are ported from, or written with reference to,
[MAME](https://www.mamedev.org/); those parts keep MAME's BSD 3-Clause
licence, and LICENSE lists them.

## Thanks

* The MAME team, for the chip and board emulation this project learned from.
* John Parker, for [Oasis](https://github.com/johnparker007/Oasis) and its
  reading of the MFME layout format.
* Mitsutaka Okazaki, for [emu2413](https://github.com/digital-sound-antiques/emu2413).
* The layout authors and ROM dumpers who keep these machines playable.
