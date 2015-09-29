var Promise = require("bluebird");
var chalksay = require('chalksay');
var jdbc = require('jdbc');
var jinst = require('jdbc/lib/jinst');

var DEFAULT_FETCH_SIZE = 100;

var teradataInstance;
var teradataConfig = {properties: {}};
var tdConn;

function createPromisedStatement(query) {
    return tdConn.conn.createStatementAsync()
        .then(function (statement) {
            queryStatement = Promise.promisifyAll(statement);
            return queryStatement;
        })
}
function createPromisedPreparedStatement(query) {
    return tdConn.conn.prepareStatementAsync(query)
        .then(function (statement) {
            queryStatement = Promise.promisifyAll(statement);
            return queryStatement;
        })
        .disposer(function(statement) {
            statement.close(function(err) {
                if (err) chalksay.blue('Error closing statement: '+err);
            });
        });
}
Teradata = {
    connect: function (url, user, password) {
        //config using user settings
        teradataConfig.url = url;
        teradataConfig.properties.user = user;
        teradataConfig.properties.password = password;

        //add jars to classpath
        if (!jinst.isJvmCreated()) {
            jinst.addOption("-Xrs");
            jinst.setupClasspath([
                './jars/terajdbc4.jar',
                './jars/tdgssconfig.jar'
            ]);
        }

        //init jvm and reserve teradata connection
        teradataInstance = Promise.promisifyAll(new jdbc(teradataConfig));

        return teradataInstance.initializeAsync()
            .then(function () {
                chalksay.green("Successfully initialized Teradata connection to %s ", teradataConfig.url);
                return teradataInstance.reserveAsync();
            })
            .then(function (teradataConnection) {
                chalksay.green("Teradata connected and ready for queries");
                tdConn = teradataConnection;
                Promise.promisifyAll(tdConn.conn);
                return teradataConnection;
            })
    },

    disconnect: function () {
        return teradataInstance.releaseAsync(tdConn)
            .then(function (err) {
                return teradataInstance.terminateAsync();
            })
            .then(function (err) {
                chalksay.green("Teradata database disconnected");
            });
    },

    executeQuery: function (query, fetchSize) {
        var queryFetchSize = fetchSize ? fetchSize : DEFAULT_FETCH_SIZE;
        var queryStatement;
        return createPromisedStatement(query)
            .then(function (statement) {
                queryStatement = Promise.promisifyAll(statement);
                return queryStatement.setFetchSizeAsync(queryFetchSize);
            })
            .then(function () {
                return queryStatement.executeQueryAsync(query);
            })
            .then(function (resultSet) {
                var asyncResultSet = Promise.promisifyAll(resultSet);
                return asyncResultSet.toObjArrayAsync();
            })
            .then(function (resultSetArray) {
                console.log(resultSetArray);
                return resultSetArray;
            })
    },

    executePreparedStatement: function (query, args, fetchSize) {
        var queryFetchSize = fetchSize ? fetchSize : DEFAULT_FETCH_SIZE;
        var queryStatement;
        args = args || [];
        return Promise.using(createPromisedPreparedStatement(query), function (statement) {
            queryStatement = Promise.promisifyAll(statement);
            return Promise.using(function() {
                return Promise.all(args.map(function(arg,index) {
                    switch (typeof arg) {
                    case 'number':
                        return queryStatement.setIntAsync(index+1,arg);
                    case 'string':
                        return queryStatement.setStringAsync(index+1,arg);
                    default:
                        throw new Error('Invalid argument of type ' + typeof arg);
                    }
                }))
                .then(function() {
                    return queryStatement.setFetchSizeAsync(queryFetchSize);
                })
                .then(function() {
                    return queryStatement.executeQueryAsync();
                })
                .disposer(function(resultSet) {
                    resultSet.close(function(err) {
                        if (err) chalksay.blue('Error closing resultset: '+err);
                    });
                });
            }(),function(resultSet) {
                var asyncResultSet = Promise.promisifyAll(resultSet);
                return asyncResultSet.toObjArrayAsync();
            });
        });
    },

    executeUpdate: function (query) {
        var updateStatement;
        return createPromisedStatement(query)
            .then(function (promisedStatement) {
                return promisedStatement.executeUpdateAsync(query);
            })
            .then(function (updateCount) {
                return updateCount;
            })
    },

    status: function() {
        tdConn && tdConn.status && tdConn.status();
    }
};

module.exports = Teradata;