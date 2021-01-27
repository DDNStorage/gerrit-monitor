const path = require('path')

const fetch = require('node-fetch')
const debug = require('debug')('gerrit-lib')
const fs = require('fs')
const config = require('config')

const SPOTLIGHT_RECORDS = 100
const NON_WIP_RECORDS = 200
const WIP_RECORDS = 300

const GERRIT_RECORD_COUNT_DEFAULT = 100

const LOG_FILENAME =
  config.has('monitor') &&
  config.monitor.has('log') &&
  config.monitor.log.has('filename')
    ? config.monitor.log.filename
    : 'snapshot-log'

const EMPTY_LOG_TEMPLATE = { latest: {}, previous: {} }

class Gerrit {
  constructor() {
    this.data = {}
    this.parsed = false
    this.fetchDate = false
    this.log = { latest: {} }
    this.latestTimestamp = false
    this.prevTimestamp = false
    this.newMergedPatches = false

    // Create the log file if it doesn't exist
    if (
      !fs.existsSync(
        config.dataDir + path.sep + LOG_FILENAME + config.dataFileExt
      )
    ) {
      // debug(`Log file doesn't exist... Creating it.`)
      this.previous = false
      fs.writeFileSync(
        config.dataDir + path.sep + LOG_FILENAME + config.dataFileExt,
        JSON.stringify(EMPTY_LOG_TEMPLATE)
      )
      debug(`Log file didn't exist, so created it [EMPTY_LOG_TEMPLATE].`)
    }
  }

  readLogFile() {
    debug(`readLogFile() called`)
    let filename = config.dataDir + path.sep + LOG_FILENAME + config.dataFileExt
    if (fs.existsSync(filename)) {
      this.log = JSON.parse(fs.readFileSync(filename))
      debug(`...returning existing log: filename: ${filename}`)
      return this.log
    } else {
      // Log file doesn't exist, so return empty array
      debug(`...file doesn't exist, so returning EMPTY_LOG_TEMPLATE`)
      return EMPTY_LOG_TEMPLATE
    }
  }

  updateLogFile(newLatest) {
    debug(`updateLogFile(${newLatest}) called`)
    // Save latest
    // if (!Object.keys(this.data).includes('open')) {
    //   debug(`... setting this.log to EMPTY_LOG_TEMPLATE`)
    //   this.log = EMPTY_LOG_TEMPLATE
    // }
    this.readLogFile()

    // Calc merged patch delta
    this.newMergedPatches = []
    if (this.log.previous && this.log.previous.merged) {
      this.newMergedPatches = this.log.previous.merged.filter(
        (x) => !this.log.latest.merged.includes(x)
      )
    }
    debug(`... newMergedPatches: `, this.newMergedPatches)

    // debug(`... setting this.log.previous to `, this.log.latest)
    // if (this.log.latest && Object.keys(this.log.latest).includes('timestamp')) {
    this.log.previous = this.log.latest
    // }

    this.log.latest = {
      timestamp: newLatest,
      merged: this.getMergedPatchList(newLatest),
      newMergedPatches: this.newMergedPatches,
    }

    this.log.latest.urgentPatches = this._getUrgentPatches(this.data['open'])

    let logContent = JSON.stringify(this.log)
    let logfilename =
      config.dataDir + path.sep + LOG_FILENAME + config.dataFileExt
    let logfilenameCurrent =
      config.dataDir +
      path.sep +
      LOG_FILENAME +
      '-' +
      newLatest +
      config.dataFileExt

    debug(
      `About to write to the log files: ${this.log.latest.timestamp} timestamp`
    )

    fs.writeFileSync(logfilename, logContent)
    fs.writeFileSync(logfilenameCurrent, logContent)

    debug(`...done writing to both files`)
    return this.log.latest
  }

  getLatestData(status = 'open') {
    this.latestTimestamp = this.log.latest
    return JSON.parse(
      fs.readFileSync(
        config.dataDir +
          path.sep +
          LOG_FILENAME +
          '-' +
          status +
          '-' +
          this.latestTimestamp +
          config.dataFileExt
      )
    )
  }

  getMergedPatchList(timestamp) {
    debug(`getMergedPatchList(${timestamp}) called...`)
    let data = JSON.parse(
      fs.readFileSync(
        config.dataDir +
          path.sep +
          LOG_FILENAME +
          '-merged-' +
          timestamp +
          config.dataFileExt
      )
    )
    return data.map((x) => x._number)
  }

  getPreviousData(status = 'open') {
    debug(
      `getPreviousData(${status}) called...\n\tthis.log.previous = ${this.log.previous}`
    )
    if (this.log.previous && this.log.previous.timestamp) {
      this.prevTimestamp = this.log.previous.timestamp
      return JSON.parse(
        fs.readFileSync(
          config.dataDir +
            path.sep +
            LOG_FILENAME +
            '-' +
            status +
            '-' +
            this.log.previous +
            config.dataFileExt
        )
      )
    } else {
      return {}
    }
  }

  async fetchGerritData(status = 'open') {
    return new Promise(async (resolve, reject) => {
      debug(`fetch(${status}) called...`)
      // First, pull it...
      try {
        let response = await fetch(
          config.gerritUrlBase +
            config.gerritUrlPrefix +
            status +
            config.gerritUrlSuffix +
            (config.monitor &&
            config.monitor.gerritRecordCount &&
            typeof config.monitor.gerritRecordCount == 'number'
              ? `&n=${config.monitor.gerritRecordCount}`
              : `&n=${GERRIT_RECORD_COUNT_DEFAULT}`)
        )
        let raw = await response.text()

        debug(`...raw set [${status}]`)
        // Then clean it...
        if (raw.split(/\r?\n/)[0] == ")]}'") {
          let orig = raw.split(/\r?\n/)
          orig.shift()
          raw = orig.join('')
        }
        debug(`...raw cleaned [${status}]`)

        // Now store it...
        // - To variables
        this.data[status] = JSON.parse(raw)
        this.fetchDate = this.now
        this.latestTimestamp = this.now
        debug(
          `...data/fetchDate/latestTimestamp set [${status}]: ${this.fetchDate}/${this.latestTimestamp}`
        )

        // - To cache file
        debug(`writing to data file [${status}]: `, this.data[status].length)
        fs.writeFileSync(
          config.dataDir +
            path.sep +
            LOG_FILENAME +
            '-' +
            status +
            '-' +
            this.now +
            config.dataFileExt,
          JSON.stringify(this.data[status])
        )
        debug(`returning from fetchGerritData [${status}]`)
        resolve(this.data[status])
      } catch (err) {
        reject(err)
      }
    })
  }

  async fetchAndLog() {
    debug(`fetchAndLog() called...`)
    this.now = Date.now()
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(config.dataDir)) {
        debug(`Creating data directory [${status}]: ${config.dataDir}`)
        fs.mkdirSync(config.dataDir)
      }

      Promise.all([
        this.fetchGerritData('open'),
        this.fetchGerritData('merged'),
      ]).then((results) => {
        let openData = results[0]
        let mergedData = results[1]
        debug(
          `...results of Promise.all: ${openData.length} open and ${mergedData.length} merged records`
        )
        let logfileContents = this.updateLogFile(this.now)
        debug(`f&l: after updateLogFile(${this.now})`)
        debug(
          `f&l: logfileContents:\n\ttimestamp: ${logfileContents.timestamp};\n\tmerged.length: ${logfileContents.merged.length};\n\tnewMergedPatches: `,
          logfileContents.newMergedPatches
        )
        debug(
          `f&l: returning // open: ${this.data['open'].length > 0}; merged: ${
            this.data['merged'].length > 0
          }`
        )

        resolve({
          open: this.data['open'].length,
          merged: this.data['merged'].length,
        })
      })
    })
  }

  delta() {
    // What is the prior data?

    /* Note: Have to have at least 2 entries:
     * the current entry (i.e. this.log.processed.length-1)
     * and one or more prior entries
     */
    // debug(`this.log: `, this.log)
    if (Object.keys(this.log.previous).includes('urgentPatches')) {
      // Have processed prior data

      // Compare
      let nowUrgent = this.log.latest.urgentPatches
      let prevUrgent = this.log.previous.urgentPatches

      // debug(`...prevUrgent items: `, prevUrgent)
      // debug(`...nowUrgent items: `, nowUrgent)

      const deltaList = { count: 0, add: [], drop: [] }
      let prevList = prevUrgent.map(
        (x) =>
          `<${config.gerritUrlBase}/${x.id}|${x.id}>: ${x.subject} (${
            config.has('slack') &&
            config.slack.has('users') &&
            Object.keys(config.slack.users).includes(x.email)
              ? `<@${config.slack.users[x.email]}>`
              : `${x.owner} ${x.email}`
          })`
      )
      let nowList = nowUrgent.map(
        (x) =>
          `<${config.gerritUrlBase}/${x.id}|${x.id}>: ${x.subject} (${
            config.has('slack') &&
            config.slack.has('users') &&
            Object.keys(config.slack.users).includes(x.email)
              ? `<@${config.slack.users[x.email]}>`
              : `${x.owner} ${x.email}`
          })`
      )

      debug(
        `prev: timestamp: ${
          this.log.previous.timestamp
        }; prevList: ${prevList.join(',')}`
      )
      debug(
        `now: timestamp: ${this.log.latest.timestamp}; nowList: ${nowList.join(
          ','
        )}`
      )

      prevList.forEach((id) => {
        if (!nowList.includes(id)) {
          deltaList.drop.push(id)
          deltaList.count++
        }
      })
      nowList.forEach((id) => {
        if (!prevList.includes(id)) {
          deltaList.add.push(id)
          deltaList.count++
        }
      })
      debug(`deltaList: `, deltaList)

      return deltaList
    } else {
      // Not enough data points
      debug(`Need at least two data points to compare. Returning empty list.`)
      return []
    }
  }

  async getUrgentPatches() {
    debug(`getUrgentPatches() this.data.length: `, this.data.length)
    return this._getUrgentPatches(this.data)
  }

  _getUrgentPatches(data) {
    debug(
      `_getUrgentPatches() called: ${data ? data.length : 'undef'} total items`
    )
    const urgentPatches = []
    if (data) {
      data.forEach((d) => {
        if (d.hashtags.length > 0 && d.hashtags.includes('urgent')) {
          urgentPatches.push({
            id: d._number,
            subject: d.subject,
            owner: d.owner.name,
            email: d.owner.email,
            vScore: this.getVScore(d),
          })
        }
      })
    }
    debug(`... returning `) // , urgentPatches)
    return urgentPatches
  }

  /**
   * Calculate the summary Verified score for the supplied patch
   *
   * @param {object} patch JSON patch data from Gerrit
   * @returns {string|number} Value - return "+1" if Max is 1, otherwise Min
   */
  getVScore(patch) {
    let vScore = 0
    if (patch.labels.Verified && patch.labels.Verified.all) {
      vScore = patch.labels.Verified.all.map((x) => (x.value ? x.value : 0))

      let vScoresMax = vScore.reduce((max, cur) => Math.max(max, cur))
      let vScoresMin = vScore.reduce((min, cur) => Math.min(min, cur))

      if (vScoresMax == 1) {
        vScore = '+1'
      } else if (vScoresMin == -1) {
        return -1
      } else {
        return 0
      }
    }
    return vScore
  }
}

module.exports = Gerrit
