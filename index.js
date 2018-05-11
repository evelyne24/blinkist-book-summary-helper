'use strict';


const cheerio = require('cheerio');
const config = require('config');
const rp = require('request-promise');
const Turndown = require('turndown');
const markdownpdf = require('markdown-pdf');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs-extra'));
const changeCase = require('change-case');


const turndown = new Turndown({
    headingStyle: 'atx'
});

let headers = {
    'Origin': 'https://www.blinkist.com',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3021.0 Safari/537.36',
    'Authority': 'www.blinkist.com',
    'Upgrade-Insecure-Requests': '1',
};

const agent = rp.defaults({
    gzip: true,
    jar: true,
    followRedirect: true,
    followAllRedirects: true,
    resolveWithFullResponse: true,
    headers: headers,
});



/*
*
*/
function loadBooks() {
    return agent('https://www.blinkist.com/en/books.html');
}

/*
*
*/
function parseCsrfToken(html) {
    const $ = cheerio.load(html);
    return $('meta[name="csrf-token"]').attr('content');
}


/*
*
*/
function setup(token) {
    return agent('https://www.blinkist.com/api/mickey_mouse/setup', {
        json: true,
        headers: Object.assign({}, headers, {
            'Accept': 'application/json',
            'Referer': 'https://www.blinkist.com/en/nc/library/',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': token
        })
    });
}

/*
*
*/
function login(token) {
    const username = config.get('username');
    const password = config.get('password');
    console.log('---- LOGIN %s  ----', token);
    return agent({
        method: 'POST',
        uri: 'https://www.blinkist.com/en/nc/login/',
        formData: {
            'login[email]': username,
            'login[password]': password,
            'login[facebook_access_token]': '',
            'authenticity_token': token
        }
    });
}

/*
*
*/
function getBook(book) {
    return fetchBook(book)  
        .then(response => parseChapters(book, response.body))
        .then(chapters => createBook(book, chapters)); 
}

/*
*
*/
function fetchBook(book) {
    console.log('---- FETCHING %s ---', book);
    return agent(`https://www.blinkist.com/en/nc/reader/${book}-${lang}/`);
}


/*
*
*/
function parseChapters(book, body) {
    const chapters = [];
    const $ = cheerio.load(body);
    const bookTitle = changeCase.titleCase(changeCase.sentence(book));
    // prepend the book title
    $('article .shared__reader__blink reader__container__content').prepend(`<h1>${bookTitle}</h1><br/><br/>`);
    $('div[class="chapter chapter"]').each((i, el) => {
        var $el = $(el);
        const chapter = $el.find('h1').text();
        // make the titles slightly smaller
        $el.find('h1').replaceWith(`<br/><h2>${changeCase.upperCaseFirst(chapter)}</h2>`);
        chapters.push({
            file: `${output}/${book}/${changeCase.snake(chapter)}.md`,
            content: turndown.turndown($el.html())
        });
    });
    return chapters;
}


/*
*
*/
function createBook(book, chapters) {
    const path = `${output}/${book}`;
    return Promise.map(chapters, c =>  fs.outputFile(c.file, c.content).then(_ => c.file))
        .then(files => concatFiles(`${output}/${book}.pdf`, files))
        .then(result => deleteFiles(path, result.files));
}

/*
*
*/
function concatFiles(book, files) {
    return new Promise((resolve, _) => {
        console.log('--- Making pdf %s ---', book);
        markdownpdf().concat.from(files).to(book, function () {
            resolve({
                bookPath: book,
                files:files
            });
        });
    });
}

/*
*
*/
function deleteFiles(book, files) {
    return Promise.all(files.map(file => fs.unlink(file)))
        .then(_ => fs.rmdir(book));
}


const books = config.get('books');

const lang = 'en';
const output = 'books';

loadBooks()
    .then(response => setup(parseCsrfToken(response.body)))
    .then(response => login(response.body.authenticate.login.params.authenticity_token))
    .then(_ => books.map(getBook))
    .then(allBooks => Promise.all(allBooks))
    .catch(console.error);