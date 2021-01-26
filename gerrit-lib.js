const path = require('path')

const fetch = require('node-fetch')
const debug = require('debug')('gerrit-lib')
const fs = require('fs')
const config = require('config')

const SPOTLIGHT_RECORDS = 100
const NON_WIP_RECORDS = 200
const WIP_RECORDS = 300

const LOG_FILENAME = 'snapshot-log'
const EMPTY_LOG_TEMPLATE = { latest: {}, previous: {} }

class Gerrit {
  constructor() {
    this.data = {}
    this.parsed = false
    this.fetchDate = false
    this.log = false
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
    if (!this.log) {
      debug(`... setting this.log to EMPTY_LOG_TEMPLATE`)
      this.log = EMPTY_LOG_TEMPLATE
    }

    // Calc merged patch delta
    this.newMergedPatches = []
    if (this.log.previous && this.log.previous.merged) {
      this.newMergedPatches = this.log.previous.merged.filter(
        (x) => !this.log.latest.merged.includes(x)
      )
    }
    debug(`... newMergedPatches: `, this.newMergedPatches)

    debug(`... setting this.log.previous to ${this.log.latest}`)
    if (this.log.latest && Object.keys(this.log.latest).includes('timestamp')) {
      this.log.previous = this.log.latest
    }

    this.log.latest = {
      timestamp: newLatest,
      merged: this.getMergedPatchList(newLatest),
      newMergedPatches: this.newMergedPatches,
    }

    this.log.latest.urgentPatches = this._getUrgentPatches(this.data['open'])

    let logContent = JSON.stringify(this.log)

    fs.writeFileSync(
      config.dataDir + path.sep + LOG_FILENAME + config.dataFileExt,
      logContent
    )

    fs.writeFileSync(
      config.dataDir + path.sep + LOG_FILENAME + '-' + newLatest + config.dataFileExt,
      logContent
    )
    return this.log.latest
  }

  getLatestData(status = 'open') {
    this.latestTimestamp = this.log.latest
    return JSON.parse(
      fs.readFileSync(
        config.dataDir +
          path.sep +
          'snapshot-' +
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
          'snapshot-merged-' +
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
            'snapshot-' +
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
    debug(`fetch(${status}) called...`)
    return new Promise(async (resolve, reject) => {
      // First, pull it...
      const response = await fetch(
        config.gerritUrlBase +
          config.gerritUrlPrefix +
          status +
          config.gerritUrlSuffix
      )
      let raw = await response.text()

      debug(`...raw set`)
      // Then clean it...
      if (raw.split(/\r?\n/)[0] == ")]}'") {
        let orig = raw.split(/\r?\n/)
        orig.shift()
        raw = orig.join('')
      }
      debug(`...raw cleaned`)

      // Now store it...
      // - To variables
      this.data[status] = JSON.parse(raw)
      this.fetchDate = this.now
      this.latestTimestamp = this.now
      debug(
        `...data/fetchDate/latestTimestamp set: ${this.fetchDate}/${this.latestTimestamp}`
      )

      if (!fs.existsSync(config.dataDir)) {
        debug(`Creating data directory: ${config.dataDir}`)
        fs.mkdirSync(config.dataDir)
      }

      // - To cache file
      debug(`f&l: writing to data file: `, this.data[status].length)
      fs.writeFileSync(
        config.dataDir +
          path.sep +
          'snapshot-' +
          status +
          '-' +
          this.now +
          config.dataFileExt,
        JSON.stringify(this.data[status])
      )
      resolve(this.data[status])
    })
  }

  async fetchAndLog() {
    debug(`fetchAndLog() called...`)
    this.now = Date.now()
    return new Promise(async (resolve, reject) => {
      Promise.all([
        this.fetchGerritData('open'),
        this.fetchGerritData('merged'),
      ]).then((values) => {
        debug(
          `...results of Promise.all: ${values[0].length} open and ${values[1].length} merged records`
        )
        if ((this.log = this.readLogFile())) {
          // Update the log
          debug(
            `f&l: before updateLogFile call: this.log.previous.length = `,
            this.log.previous.length
          )
          let result = this.updateLogFile(this.now)
          debug(`f&l: after updateLogFile(${this.now})`)
          resolve(this.data['open'].length > 0)
        } else {
          console.error(`Failed to read the log file`)
          reject(`Unable to read log file`)
        }
      })
    })
  }

  delta() {
    // What is the prior data?

    /* Note: Have to have at least 2 entries:
     * the current entry (i.e. this.log.processed.length-1)
     * and one or more prior entries
     */
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
    // return new Promise(async (resolve, reject) => {
    // const data = this.data ? this.data : await this.fetchAndLog()
    debug(`getUrgentPatches() this.data.length: `, this.data.length)
    return this._getUrgentPatches(this.data)
    // })
  }

  _getUrgentPatches(data) {
    debug(`_getUrgentPatches() called: ${data ? data.length : 'undef'}`)
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
