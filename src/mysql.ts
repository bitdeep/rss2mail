import { blue, magenta, green, yellow, red, gray } from 'colors'
import colors from 'colors'
import mysql from 'mysql2/promise'
import { ConnectionOptions } from 'mysql2'
import fs from 'fs'
let connection: mysql.Connection, connectionInfo: string
let count = 0,
    errors = 0
async function init(): Promise<any> {
    if (connection) return connection
    let HOST = process.env.MYSQL_HOST || ''
    const is_docker =
        fs.existsSync('/proc/self/cgroup') && fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker')
    const OS = process.env.OS || ''
    if (!is_docker && OS === 'Windows_NT') {
        HOST = process.env.MYSQL_HOST_DEV || HOST
    }
    const PORT = parseInt(process.env.MYSQL_PORT || '0')
    const USER = process.env.MYSQL_USER || ''
    const PASSWORD = process.env.MYSQL_PASSWORD || ''
    const DATABASE = process.env.MYSQL_DATABASE || ''
    let c: ConnectionOptions = {
        host: HOST,
        port: PORT,
        user: USER,
        password: PASSWORD,
        database: DATABASE,
    }
    connectionInfo = '[mysql] ' + c.user + '@' + c.host + ':' + c.port + '/' + c.database + ' '
    console.log(green(connectionInfo))
    connection = await mysql.createConnection(c)
    return connection
}

async function call(procedure: string, args: any[] = [], debug: boolean = false): Promise<any> {
    if (!_security(procedure)) return { error: 'SECURITY ERROR' }
    let placeholders: any[] = []
    for (let i = 0; i < args.length; i++) placeholders.push('?')
    const str = 'CALL ' + procedure + '(' + placeholders.join(', ') + ')'
    if (debug) {
        // Fetch procedure arguments from MySQL 8 schema
        const argQuery = `
			SELECT *
			FROM information_schema.PARAMETERS
			WHERE SPECIFIC_NAME = ? AND SPECIFIC_SCHEMA = DATABASE()
			ORDER BY ORDINAL_POSITION
		`
        const argResults = await sql(argQuery, [procedure])
        let argInfo: { name: string; type: string; nullable: boolean; default: string | null }[] = []
        if (argResults.length > 0) {
            argInfo = argResults.map((arg: any) => ({
                name: arg.PARAMETER_NAME,
                type: arg.DTD_IDENTIFIER,
            }))
        }
        const maxNameLength = Math.max(...argInfo.map((info) => info.name.length))
        const maxTypeLength = Math.max(...argInfo.map((info) => info.type.length))
        const paddedValuesMaxLength = args.reduce((max, arg) => Math.max(max, mysql.escape(arg).length), 0)
        const scaped_args = args.map((arg, i) => {
            const info = argInfo[i] || {
                name: 'unknown',
                type: 'unknown',
            }
            const escapedArg = mysql.escape(arg)
            const paddedName = info.name.padEnd(maxNameLength)
            const paddedType = info.type.padEnd(maxTypeLength)
            return `${escapedArg.padEnd(paddedValuesMaxLength)} /* ${(i + 1)
                .toString()
                .padStart(2)} - ${paddedName} ${paddedType} */`
        })
        const debug_str = 'CALL ' + procedure + '(\n    ' + scaped_args.join(',\n    ') + '\n)'
        console.log(colors.grey(debug_str))
    }
    const res = await sql(str, args, false)
    if (res && res.error) return res
    if (res && res[0] && res[0].error) return res
    const result = res && res[0] ? res[0] : []
    if (debug && result.length > 0) {
        if (result.length > 0) console.log('DEBUG', _debug(result[0]))
        if (result.length > 1) console.log('DEBUG', _debug(result[result.length - 1]))
    }
    return result
}
function _debug(r: any) {
    let p = ''
    for (const [key, value] of Object.entries(r)) {
        p += `${blue(key)}=${value} `
    }
    console.log(p)
}
function _security(str: string) {
    const match = /(\w+)\.(\w+)|(\w+)/gm.exec(str)
    if (!match) {
        console.log(red('procedure'), str)
        console.log('match', match)
        console.log(red(`SECURITY ERROR: ${str}`))
        return false
    }
    return true
}

async function sql(str: string, params: any[] = [], debug: boolean = false): Promise<any> {
    if (!str)
        return [
            {
                success: false,
                error: 'ERR-NO-SQL',
                message: 'ERROR AT [' + connectionInfo + '] SEM SQL',
            },
        ]
    if (debug) console.log(colors.yellow(str))

    if (!connection) connection = await init()

    try {
        const [results] = await connection.query(str, params)
        count++
        return results
    } catch (e: any) {
        errors++
        console.log(colors.red(e.code))
        console.log(colors.red(e.sqlMessage))
        console.log(colors.red(e.sql))
        process.exit(1)
    }
}

async function insert(procedure: string, rows: any[][], no_checks: boolean = false): Promise<any> {
    if (!no_checks) {
        if (!_security(procedure)) return { error: 'SECURITY ERROR' }
    }
    let placeholders: any[] = []
    for (let i = 0; i < rows[0].length; i++) placeholders.push('?')
    const str = 'CALL ' + procedure + '(' + placeholders.join(', ') + ')'
    try {
        await connection.beginTransaction()
        const promises: any[] = []
        for (let i = 0; i < rows.length; i++) {
            const stm: mysql.PreparedStatementInfo = await connection.prepare(str)
            promises.push(stm.execute(rows[i]))
        }
        const res = await Promise.all(promises)
        const results = res.map((r: any) => r[0][0])
        await connection.commit()
        return results
    } catch (error) {
        await connection.rollback()
        throw error
    }
}
function escape(str: string) {
    return mysql.escape(str)
}
export { init, call, sql, insert, escape }
