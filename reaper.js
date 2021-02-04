/*
 * Clean out duplicate data files
 * Keep the 2 most recent
 * Delete all other duplicates,
 * saving the oldest
 */

const config = require('config')
const debug = require('debug')('reaper')
const path = require('path')
const glob = require('glob')
const fs = require('fs')
const { cwd } = require('process')
const md5File = require('md5-file')
const { program } = require('commander')

program
  .option('-d, --dry-run', 'Dry run (i.e. do not delete any files)')
  .option('-r, --run', 'Real run (i.e. do delete any files)')
  .option(
    '-s, --status <value>',
    'Additional status to watch (default: [open, merged])'
  )
  .option('-q, --quiet', 'Turn off info messages')
  .option('-x, --exclude <filename>', 'Additional file to ignore/exclude')
  .option('-v, --verbose', 'Turn on extra info messages')

program.parse(process.argv)

const options = program.opts()

let dryRun = options.debug
  ? true
  : config.has('reaper') && config.reaper.has('dryRun')
  ? config.reaper.dryRun
  : false

if (options.run) {
  dryRun = false
}

const statusList = ['open', 'merged']
if (options.status) {
  statusList.push(options.status)
}

if (options.quiet) {
  debug.enabled = false
}

if (options.verbose) {
  debug.enabled = true
}

let excludeFiles = []
if (options.exclude) {
  excludeFiles.push(options.exclude)
}

debug(`Config/Options:
- dryRun: ${dryRun}
- data dir: ${config.dataDir}
- statusList: ${statusList.join(',')}
- exclude: ${excludeFiles.join(',')}
- verbose: ${debug.enabled}
`)

// 1. Get the list of files to exclude
debug(`chdir(${config.dataDir})...`)
process.chdir(config.dataDir)
let log = JSON.parse(
  fs.readFileSync(config.monitor.log.filename + config.dataFileExt)
)

// Update the exclude file list
statusList.forEach((status) => {
  excludeFiles.push(
    config.monitor.log.filename +
      '-' +
      status +
      '-' +
      log.latest.timestamp +
      config.dataFileExt
  )
  excludeFiles.push(
    config.monitor.log.filename +
      '-' +
      status +
      '-' +
      log.previous.timestamp +
      config.dataFileExt
  )
})
debug(excludeFiles)

let keep = []
let skipped = []
let deleted = []

// 2. Process the full list of files
statusList.forEach((status) => {
  let flist = glob.sync(`${config.monitor.log.filename}-${status}*.json`)
  debug(`flist: `, flist)

  // 2. Calc md5sums
  let lastHash = false
  let lastFile = false

  flist.forEach((f) => {
    if (excludeFiles.includes(f)) {
      debug(`skipping ${f} / excluded file`)
      skipped.push(f)
    } else {
      // process
      let hash = md5File.sync(f)
      if (hash == lastHash) {
        debug(`deleting ${f} / hash matches ${lastFile}`)
        deleted.push(f)
        if (dryRun) {
          debug(`\t>>> Dry Run: Not deleting file ${f}`)
        } else {
          try {
            fs.unlinkSync(f)
          } catch (err) {
            console.error(`Couldn't delete file ${f}: ${err}`)
          }
        }
      } else {
        debug(`keeping ${f}`)
        keep.push(f)
      }
      lastHash = hash
      lastFile = f
    }
  })
})

// 3. Print the summary
console.log(`Keeping ${keep.length} files:\n- ${keep.join('\n- ')}`)
console.log(`Skipped ${skipped.length} files:\n- ${skipped.join('\n- ')}`)
console.log(
  `Deleted ${deleted.length} files${
    dryRun ? ' *** DRY RUN ONLY ***' : ''
  }:\n- ${deleted.join('\n- ')}`
)
