const path = require('path')

const fetch = require('node-fetch')
const { Headers } = require('node-fetch')

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
      this.newMergedPatches = this.log.latest.merged.filter(
        (x) => !this.log.previous.merged.includes(x)
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
        let authRequired = config.has("gerritConfig")
          && config.gerritConfig.has("username")
          && config.gerritConfig.has("password")

        let url = config.gerritUrlBase

        let headers = new Headers()

        if (authRequired) {
          url += '/a'
          headers.set('Authorization', 'Basic ' + Buffer.from(config.gerritConfig.username + ":" + config.gerritConfig.password).toString('base64'));
        }

        url +=
            config.gerritUrlPrefix +
            status +
            config.gerritUrlSuffix +
            (config.monitor &&
            config.monitor.gerritRecordCount &&
            typeof config.monitor.gerritRecordCount == 'number'
              ? `&n=${config.monitor.gerritRecordCount}`
              : `&n=${GERRIT_RECORD_COUNT_DEFAULT}`)

        let response = await fetch(url, { method: 'GET', headers: headers })
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
    const deltaList = { count: 0, add: [], drop: [], merge: [] }

    let spotlightUrgent =
      config.has('spotlight') &&
      config.spotlight.has('enabled') &&
      config.spotlight.enabled &&
      config.spotlight.has('flags') &&
      config.spotlight.flags.has('hashtag') &&
      config.spotlight.flags.hashtag == 'urgent'
        ? true
        : false

    debug(`spotlightUrgent: ${spotlightUrgent}`)

    let slackNotification =
      config.has('spotlight') &&
      config.spotlight.has('enabled') &&
      config.spotlight.enabled &&
      config.spotlight.has('notifications') &&
      config.spotlight.notifications.has('slack') &&
      config.spotlight.notifications.slack.has('enabled') &&
      config.spotlight.notifications.slack.enabled &&
      config.spotlight.notifications.slack.has('webhookUrl')
        ? config.spotlight.notifications.slack.webhookUrl
        : false

    let fileNotification =
      config.has('spotlight') &&
      config.spotlight.has('enabled') &&
      config.spotlight.enabled &&
      config.spotlight.has('notifications') &&
      config.spotlight.notifications.has('file') &&
      config.spotlight.notifications.file.has('enabled') &&
      config.spotlight.notifications.file.enabled &&
      config.spotlight.notifications.file.has('outputFilename')
        ? config.spotlight.notifications.file.outputFilename
        : false

    // Ensure that at least one notification method is enabled
    if (slackNotification || fileNotification) {
      debug(`Notification: Slack? ${slackNotification}; File? ${fileNotification}`)
      if (spotlightUrgent) {
        if (Object.keys(this.log.previous).includes('urgentPatches')) {
          deltaList.type = "Urgent"

          // Have processed prior data

          // Compare
          let nowUrgent = this.log.latest.urgentPatches
          let prevUrgent = this.log.previous.urgentPatches

          // debug(`...prevUrgent items: `, prevUrgent)
          // debug(`...nowUrgent items: `, nowUrgent)

          let prevListIds = prevUrgent.map((x) => x.id)
          let nowListIds = nowUrgent.map((x) => x.id)
          debug(`prevListIds: `, prevListIds, `; nowListIds: `, nowListIds)

          let prevListMsgs = []
          let msg = ""

          prevUrgent.forEach(
            (x) => {
              if (slackNotification) {
                msg = `<${config.gerritUrlBase}/${x.id}|${x.id}>: ${x.subject} (${
                  config.has('slack') &&
                  config.slack.has('users') &&
                  Object.keys(config.slack.users).includes(x.email)
                    ? `<@${config.slack.users[x.email]}>`
                    : `${x.owner} ${x.email}`
                  })`
                if (!nowListIds.includes(x.id)) {
                  deltaList.count++
                  // Merged?
                  if (this.log.latest.merged.includes(x.id)) {
                    deltaList.merge.push(msg)
                  } else { // Otherwise, add to drop list
                    deltaList.drop.push(msg)
                  }
                }
              } else if (fileNotification) {
                if (!nowListIds.includes(x.id)) {
                  deltaList.count++
                  if (this.log.latest.merged.includes(x.id)) {
                    deltaList.merge.push([x.id, x.subject, x.owner].join('|'))
                  } else {
                    deltaList.drop.push([x.id, x.subject, x.owner].join('|'))
                  }
                }
              } // slackNotification /// fileNotification
            } // (x)
          ) // prevUrgent

          nowUrgent.forEach(
            (x) => {
              if (slackNotification) {
                msg = `<${config.gerritUrlBase}/${x.id}|${x.id}>: ${x.subject} (${
                  config.has('slack') &&
                  config.slack.has('users') &&
                  Object.keys(config.slack.users).includes(x.email)
                    ? `<@${config.slack.users[x.email]}>`
                    : `${x.owner} ${x.email}`
                })`
                if (!prevListIds.includes(x.id)) {
                  let reviewerList = this.getCodeReviewers(x.id)
                  let reviewers = []
                  reviewerList.forEach((rev) => {
                    reviewers.push(`${rev.name} <@${config.slack.users[rev.email]}>`)
                  })
                  deltaList.add.push(msg + ` *Reviewers*: ${reviewers.join(', ')}`)
                  deltaList.count++
                }
              } else if (fileNotification) {
                if (!prevListIds.includes(x.id)) {
                  // let reviewerList = this.getCodeReviewers(x.id)
                  // let reviewers = []
                  // reviewerList.forEach((rev) => {
                  //   reviewers.push(rev.name)
                  // })
                  deltaList.add.push([x.id, x.subject, x.owner].join('|'))
                  deltaList.count++
                }
              } // slackNotification /// fileNotification
            } // (x)
          ) // nowUrgent

          debug(`deltaList: `, deltaList)

          return deltaList
        } else {
          // Not enough data points
          debug(`Need at least two data points to compare. Returning empty list.`)
          return []
        } // this.log.previous includes urgentPatches
      } else { // urgent not highlighted, so delta everything
        deltaList.type = "Full"
        if (Object.keys(this.log.previous)) {
          deltaList.merge = this.log.latest.newMergedPatches.slice()
          deltaList.count = deltaList.merge.length
          return deltaList
        } else { // Not enough data points
          debug(`Need at least two data points to compare. Returning empty list.`)
          return []
        } // this.log.previous
      } // spotlightUrgent
    } else {
      throw new Error(`No notification mode is set, so bailing out...`)
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
   * Get a list of reviewers for a specified patch from the latest Gerrit data
   *
   * @param {number} patchId Patch ID
   * @returns {array} List of reviewers' names (excluding Jenkins)
   */
  getCodeReviewers(patchId) {
    let reviewers = []
    this.data['open'].forEach((patch) => {
      if (patch._number == patchId) {
        if (patch.labels['Code-Review'] && patch.labels['Code-Review'].all) {
          patch.labels['Code-Review'].all.forEach((r) => {
            if (r.name !== 'jenkins') {
              reviewers.push({name: r.name, email: r.email, slackId: (config.has('slack') &&
              config.slack.has('users') &&
              Object.keys(config.slack.users).includes(r.email)) ? config.slack.users[r.email] : '', score: (r.value == '1' ? '+1' : r.value)})
            }
          })
        }
        return(reviewers)
      }
    })
    return(reviewers)
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
