var express = require('express');
const { google } = require('googleapis');
const config = require('../config');
var request = require('request');
const { topLinks, Values, Links, sendLink, sendVal } = require('../db');
var _ = require('lodash');
const { SitemapStream, streamToPromise } = require('sitemap');
const { createGzip } = require('zlib');
const { Readable } = require('stream');


const requestPromise = (url) => {
  return new Promise((resolve, reject) => {
    request(url, (error, response, body) => {
      if (error) {
        reject(error);
      }
      resolve(body);
    })
  })
}
var options;

var router = express.Router();
const customsearch = google.customsearch('v1');

/* GET home page. */
router.get('/', async function (req, res, next) {
  var toplink = [];
  var topkey = [];
  var keysearch = [];
  await topLinks.findOne({ name: "topkeyall" }, {}).
    then(result => {
      let i = 0;
      if (!result) {
        console.log("Can't find topkey!")
      } else {
        _.map(result.value, o => {
          topkey[i] = [o.keyword, o.search_total, o.position, i];
          i++;
        });
        selectionSortkey(topkey);
      }
    }).catch(err => {
      console.log(err)
    });
  await topLinks.findOne({ name: "toplinkall" }, {}).
    then(result => {
      if (!result) {
        console.log("Can't find toplink!")
      } else {
        let i = 0;
        _.map(result.value, o => {
          toplink[i] = [o.link, o.search_total, o.title, o.position, i];
          i++;
        });
        selectionSort(toplink);
      }
    }).catch(err => {
      console.log(err)
    });
  await Values.aggregate([
    { $group: { _id: '$value' } },
    { $project: { _id: 1 } }
  ]).then(result => {
    let i = 0;
    _.map(result, o => {
      keysearch[i] = o["_id"];
      i++;
    })
  }).catch(err => {
    console.log(err)
  });
  res.render('index', { title: 'TimFshare.com - Tìm kiếm link Fshare nhanh chóng, chính xác', keysearch, topkey, toplink });
});


router.get('/search', (req, res, next) => {
  var { q, start, num } = req.query;
  const _keysave = q;
  q = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  customsearch.cse.siterestrict.list({
    auth: config.ggApiKey,
    cx: config.ggCx,
    q, start, num
  })
    .then(result => result.data)
    .then(async (result) => {
      var { queries, items, searchInformation } = result;
      var itemsfinal = [];
      const page = (queries.request || [])[0] || {};
      const previousPage = (queries.previousPage || [])[0] || {};
      const nextPage = (queries.nextPage || [])[0] || {};
      const keysearchurl = q.toString().split(' ', 3)
      var locksearch = 0;
      switch (keysearchurl[0]) {
        case "inurl:hdvietnam":
          locksearch = 1;
          break;
        case "inurl:fshare":
          keyfshare = q.toString().substr(13)
          break;
        case "inurl:thuvienhd":
          keyfshare = q.toString().substr(16)
          break;
        default:
      }
      if (page.startIndex == 1 && locksearch != 1) {
        const datas = await requestPromise('https://thuvienhd.com/?feed=timfsharejson&search=' + encodeURI(q));
        let result1 = JSON.parse(datas);
        // console.log(result1[0].data);
        if (result1.status == 'success') {
          let datafshare = result1.data;
          datafshare.forEach(function (value, index) {
            if (value.links.length > 0) {
              //await datafshare.splice(index, 1);
              let itemstest = {
                link: value.links[0].link,
                title: value.title,
                snippet: value.links[0].title
              };
              itemsfinal.push(itemstest);
            }
          });
        }
      }
      itemsfinal = items != undefined ? itemsfinal.concat(items) : itemsfinal;
      let data;
      if (itemsfinal.length > 0) {
        data = {
          q: _keysave,
          totalResults: page.totalResults,
          count: page.count,
          startIndex: page.startIndex,
          nextPage: nextPage.startIndex,
          previousPage: previousPage.startIndex,
          time: searchInformation.searchTime,
          items: itemsfinal.map(o => ({
            link: o.link,
            title: o.title,
            snippet: o.snippet
          }))
        }
        let dateT = new Date(Date.now());
        dateT.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
        sendVal(data.q, dateT);
      }
      // res.status(200).send(result);
      res.status(200).send(data);
    })
    .catch((err) => {
      console.log(err);
      res.status(500).send(err);
    });
})



router.get('/topkey', async (req, res, next) => {
  const { nametopkey } = req.query;
  let topkey = [];
  await topLinks.findOne({ name: nametopkey }, {}).
    then(result => {
      let i = 0;
      if (!result) {
        console.log("Can't find topkey!")
      } else {
        _.map(result.value, o => {
          topkey[i] = [o.keyword, o.search_total, o.position, i];
          i++;
        });
        selectionSortkey(topkey);
      }
    }).catch(err => {
      console.log(err)
    });
  res.status(200).send(topkey);
})

router.get('/sitemap.xml', function(req, res) {
  res.header('Content-Type', 'application/xml');
  res.header('Content-Encoding', 'gzip');
  let sitemap;
  // if we have a cached entry send it
  if (sitemap) {
    res.send(sitemap)
    return
  }

  try {
    const smStream = new SitemapStream({ hostname: 'http://timfshare.com/' })
    const pipeline = smStream.pipe(createGzip())

    // pipe your entries or directly write them.
    smStream.write({ url: '/', changefreq: 'monthly', priority: 0.1 })
    smStream.write({ url: '/sitemap-search.xml', changefreq: 'daily', priority: 1 })
    smStream.write({ url: '/?top=link', changefreq: 'weekly', priority: 0.6 })    // changefreq: 'weekly',  priority: 0.5
    smStream.write({ url: '/?top=key/', changefreq: 'weekly', priority: 0.6 })
    /* or use
    Readable.from([{url: '/page-1'}...]).pipe(smStream)
    if you are looking to avoid writing your own loop.
    */

    // cache the response
    streamToPromise(pipeline).then(sm => sitemap = sm)
    // make sure to attach a write stream such as streamToPromise before ending
    smStream.end()
    // stream write the response
    pipeline.pipe(res).on('error', (e) => {throw e})
  } catch (e) {
    console.error(e)
    res.status(500).end()
  }
})

router.get('/sitemap-search.xml', async function(req, res) {
  res.header('Content-Type', 'application/xml');
  res.header('Content-Encoding', 'gzip');
  let sitemap;
  let keysearch = [];
  await Values.aggregate([
    { $group: { _id: '$value' } },
    { $project: { _id: 1 } }
  ]).then(result => {
    let i = 0;
    _.map(result, o => {
      keysearch[i] = o["_id"];
      i++;
    })
  }).catch(err => {
    console.log(err)
  });
  // if we have a cached entry send it
  if (sitemap) {
    res.send(sitemap)
    return
  }
  try {
    const smStream = new SitemapStream({ hostname: 'http://timfshare.com/' })
    const pipeline = smStream.pipe(createGzip())
    // pipe your entries or directly write them.
    _.map(keysearch, o => {
      smStream.write({ url: '/?s='+ encodeURI(o), changefreq: 'monthly', priority: 0.6 })
    })
    // cache the response
    streamToPromise(pipeline).then(sm => sitemap = sm)
    // make sure to attach a write stream such as streamToPromise before ending
    smStream.end()
    // stream write the response
    pipeline.pipe(res).on('error', (e) => {throw e})
  } catch (e) {
    console.error(e)
    res.status(500).end()
  }
})

router.get('/toplink', async (req, res, next) => {
  const { nametoplink } = req.query;
  let toplink = [];
  await topLinks.findOne({ name: nametoplink }, {}).
    then(result => {
      if (!result) {
        console.log("Can't find toplink!")
      } else {
        let i = 0;
        _.map(result.value, o => {
          toplink[i] = [o.link, o.search_total, o.title, o.position, i];
          i++;
        });
        selectionSort(toplink);
      }
    }).catch(err => {
      console.log(err)
    });
  res.status(200).send(toplink);
});

router.post('/values', function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  var val = req.body.value;
  var date = req.body.date;
  if (val === undefined || val === "") {
    res.send(JSON.stringify({ status: "error", value: "Value undefined" }));
    return
  }
  sendVal(val, date, res);
});
router.post('/links', function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  var val = req.body.value;
  var link = req.body.link;
  var title = req.body.title;
  var date = req.body.date;
  if (val === undefined || val === "") {
    res.send(JSON.stringify({ status: "error", value: "Value undefined" }));
    return
  }
  sendLink(val, link, title, date, res);
});

function selectionSort(array) {
  for (let i = 0; i < array.length - 1; i++) {
    let idmin = i;
    for (let j = i + 1; j < array.length; j++) {
      if (array[j][3] < array[idmin][3]) idmin = j;
    }
    // swap
    let t = array[i];
    array[i] = array[idmin];
    array[idmin] = t;
  }
}

function selectionSortkey(array) {
  for (let i = 0; i < array.length - 1; i++) {
    let idmin = i;
    for (let j = i + 1; j < array.length; j++) {
      if (array[j][2] < array[idmin][2]) idmin = j;
    }
    // swap
    let t = array[i];
    array[i] = array[idmin];
    array[idmin] = t;
  }
}

module.exports = router;
