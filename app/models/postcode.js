var	fs = require("fs"),
		S = require("string"),
		util = require("util"),
		path = require("path"),
		Pc = require("postcode"),
		async = require("async"),
		OSPoint = require("ospoint"),
		Base = require("./index").Base;

var postcodeSchema = {
	"id": "SERIAL PRIMARY KEY",
	"postcode" : "VARCHAR(10)",
	"pc_compact" : "VARCHAR(9)",
	"quality" : "INTEGER",
	"eastings" : "INTEGER",
	"northings" : "INTEGER",
	"country" : "VARCHAR(255)",
	"nhs_ha" : "VARCHAR(255)",
	"admin_county" : "VARCHAR(255)",
	"admin_district" : "VARCHAR(255)",
	"admin_ward" : "VARCHAR(255)",
	"longitude" : "DOUBLE PRECISION",
	"latitude" : "DOUBLE PRECISION",
	"location" : "GEOGRAPHY(Point, 4326)",
	"parliamentary_constituency" : "VARCHAR(255)",
	"european_electoral_region" : "VARCHAR(255)",
	"primary_care_trust" : "VARCHAR(255)", 
	"region" : "VARCHAR(255)", 
	"parish" : "VARCHAR(255)", 
	"lsoa" : "VARCHAR(255)", 
	"msoa" : "VARCHAR(255)",
	"nuts" : "VARCHAR(255)",
	"incode" : "VARCHAR(5)",
	"outcode" : "VARCHAR(5)",
	"ccg" : "VARCHAR(255)"
};

var indexes = [{
	unique: true,
	column: "postcode"
}, {
	unique: true,
	column: "pc_compact",
	opClass: "varchar_pattern_ops"
}, {
	type: "GIST",
	column: "location"
}, {
	column: "outcode"
}];

function Postcode () {
	Base.call(this, "postcodes", postcodeSchema, indexes);
}

util.inherits(Postcode, Base);

Postcode.prototype.find = function (postcode, callback) {
	if (typeof postcode !== "string") {
		return callback(null, null);
	} 

	postcode = postcode.trim().toUpperCase();

	if (!new Pc(postcode).valid()) {
		return callback(null, null);
	}

	var query = "SELECT * FROM " + this.relation + " WHERE pc_compact=$1";

	this._query(query, [postcode.replace(" ", "")], function(error, result) {
		if (error) return callback(error, null);
		if (result.rows.length === 0) {
			return callback(null, null);
		}
		callback(null, result.rows[0]);
	});
}

Postcode.prototype.random = function (callback) {
	var query	=	"SELECT * FROM  ("+
					    "SELECT 1 + floor(random() * (SELECT count(id) FROM postcodes))::integer AS id "+
					    "FROM   generate_series(1, 100) g "+
					    "GROUP BY 1 "+
					    ") r "+
							"JOIN postcodes USING (id) "+
							"LIMIT  1;"

	this._query(query, function (error, result) {
		if (error) return callback(error, null);
		if (result.rows.length === 0) {
			return callback(null, null);
		}
		callback(null, result.rows[0]);
	});
}

Postcode.prototype.populateLocation = function (callback) {
	var query = "UPDATE postcodes SET location=ST_GeogFromText" + 
							"('SRID=4326;POINT(' || longitude || ' ' || latitude || ')')" + 
							" WHERE northings!=0 AND EASTINGS!=0";
	this._query(query, callback);
}

Postcode.prototype.search = function (postcode, options, callback) {
	var limit;
	if (typeof options === 'function') {
		callback = options;
		limit = 10;
	} else {
		limit = parseInt(options.limit, 10);
		if (isNaN(limit)) limit = 10;
		if (limit > 100) limit = 100;
	}
	
	var	query = "SELECT * FROM " + this.relation  + " WHERE pc_compact ~ $1 LIMIT $2",
			re = "^" + postcode.toUpperCase().replace(" ", "") + ".*";
			
	this._query(query, [re, limit], function (error, result) {
		if (error) return callback(error, null);
		if (result.rows.length === 0) {
			return callback(null, null);
		}
		return callback(null, result.rows);
	});
}

Postcode.prototype.nearestPostcodes = function (params, callback) {
	var radius = parseFloat(params.radius) || 100;
	if (radius > 1000) radius = 1000;

	var limit = parseInt(params.limit, 10) || 10;
	if (limit > 100) limit = 100;

	var longitude = parseFloat(params.longitude);
	if (isNaN(longitude)) return callback(new Error("Invalid longitude"), null);

	var latitude = parseFloat(params.latitude);
	if (isNaN(latitude)) return callback(new Error("Invalid latitude"), null);

	var query = "SELECT *, ST_Distance(location, " + 
							" ST_GeographyFromText('POINT(' || $1 || ' ' || $2 || ')')) AS distance " + 
							"FROM postcodes " + 
							"WHERE ST_DWithin(location, ST_GeographyFromText('POINT(' || $1 || ' ' || $2 || ')'), $3) " + 
							"ORDER BY distance LIMIT $4";
	this._query(query, [longitude, latitude, radius, limit], function (error, result) {
		if (error) return callback(error, null);
		if (result.rows.length === 0) {
			return callback(null, null);
		}
		return callback(null, result.rows);
	});
}

Postcode.prototype.findOutcode = function (outcode, callback) {
	outcode = outcode.trim().toUpperCase();

	if (!Pc.validOutcode(outcode)) {
		return callback(null, null);
	}

	var query = "Select avg(northings) as northings, avg(eastings) as eastings, " + 
							"avg(ST_X(location::geometry)) as longitude, avg(ST_Y(location::geometry))" + 
							" as latitude FROM postcodes WHERE postcodes.outcode=$1";

	this._query(query, [outcode], function (error, result) {
		if (error) return callback(error, null);
		if (result.rows.length !== 1) return callback(null, null);
		var outcodeResult = result.rows[0];
		if (!outcodeResult.eastings || !outcodeResult.northings) {
			return callback(null, null);
		}
		outcodeResult.outcode = outcode;
		return callback(null, result.rows[0]);
	});
}

Postcode.prototype.toJson = function (address) {
	delete address.id;
	delete address.location;
	delete address.pc_compact;
	return address;
}

/*
*  	ONS CSV Data Reference
*
*		0 - Unit postcode (7char)
*		1 - Unit postcode (8char)
*		2 - Unit postcode (variable)											Y
*		3 - Date of intro
*		4 - Date of termination (null = live)
*		5 - County 																				Y
*		6 - District 																			Y
*		7 - Ward 																					Y
*		8 - Postcode user type (small/large)
*		9 - Easting 																			Y
*		10 - Northings 																		Y
*		11 - Positional quality indicator 								Y
*		12 - Strategic health authority (SHA) (nhs_ha) 		Y
*		13 - Pan SHA (nhs_regional) 											
*		14 - Country 																			Y
*		15 - Region (region code, GOR)										Y
*		16 - Standard statistical region (SSR)
*		17 - Westminster parliamentary constituency 			Y
*		18 - European Electoral Register									Y
*		19 - Local learning and skills council
*		20 - Travel to work area
*		21 - Primary care trust 													Y
*		22 - NUTS / LAU areas 														Y
*		23 - 1991 census ed
*		24 - 1991 census ed with census code
*		25 - ed positional quality indicator
*		26 - Previous SHA prior to 2006
*		27 - LEA
*		28 - Health Authority (old style)
*		29 - 1991 ward
*		30 - 1991 ward OGSS code
*		31 - 1998 ward
*		32 - 2005 statistical ward
*		33 - 2001 census output area
*		34 - census area statistics ward
*		35 - national park
*		36 - 2001 LSOA
*		37 - 2001 MSOA
*		38 - 2001 rural/urban indicator
*		39 - 2001 OAC
*		40 - Old PCT
*		41 - 2011 census output areas 									Y
*		42 - 2011 LSOA																	Y
*		43 - 2011 MSOA 																	Y
*		44 - Parish 																		Y
*		45 - Census workplace zone
*
*
*/

Postcode.prototype.seedPostcodes = function (filePath, callback) {
	var self = this;
	var csvColumns = 	"postcode, pc_compact, eastings, northings, longitude," +
										" latitude, country, nhs_ha," + 
										" admin_county, admin_district, admin_ward, parish, quality," +
										" parliamentary_constituency , european_electoral_region, region, " +
										" primary_care_trust, lsoa, msoa, nuts, incode, outcode, ccg";
	var dataPath = path.join(__dirname, "../../data/");
	var countries = JSON.parse(fs.readFileSync(dataPath + "countries.json"));
	var nhsHa = JSON.parse(fs.readFileSync(dataPath + "nhsHa.json"));
	var counties = JSON.parse(fs.readFileSync(dataPath + "counties.json"));
	var districts = JSON.parse(fs.readFileSync(dataPath + "districts.json"));
	var wards = JSON.parse(fs.readFileSync(dataPath + "wards.json"));
	var parishes = JSON.parse(fs.readFileSync(dataPath + "parishes.json"));
	var constituencies = JSON.parse(fs.readFileSync(dataPath + "constituencies.json"));
	var european_registers = JSON.parse(fs.readFileSync(dataPath + "european_registers.json"));
	var regions = JSON.parse(fs.readFileSync(dataPath + "regions.json"));
	var pcts = JSON.parse(fs.readFileSync(dataPath + "pcts.json"));
	var lsoa = JSON.parse(fs.readFileSync(dataPath + "lsoa.json"));
	var msoa = JSON.parse(fs.readFileSync(dataPath + "msoa.json"));
	var nuts = JSON.parse(fs.readFileSync(dataPath + "nuts.json"));
	var ccg = JSON.parse(fs.readFileSync(dataPath + "ccg.json"));
			

	var transform = function (row, index) {
		// Skip row if terminated
		if (row[4].length !== 0) {
			return null;
		}

		var finalRow = [];

		finalRow.push(row[2]);  												// postcode
		finalRow.push(row[2].replace(/\s/g, ""));				// pc_compact
		finalRow.push(row[9]);													// Eastings
		finalRow.push(row[10]);													// Northings

		var location;
		if (row[9].length === 0 || row[10].length === 0) {
			location = {
				longitude: "",
				latitude: ""
			};
		} else if (row[14] === "N92000002") {
			location = new OSPoint("" + row[10] , "" + row[9]).toWGS84("irish_national_grid");
		} else {
			location = new OSPoint("" + row[10] , "" + row[9]).toWGS84();
		}
		
		finalRow.push(location.longitude);							// longitude
		finalRow.push(location.latitude);								// latitude
		finalRow.push(countries[row[14]]);							// Country
		finalRow.push(nhsHa[row[12]]);									// NHS Health Authority
		finalRow.push(counties[row[5]]);								// County
		finalRow.push(districts[row[6]]);								// District
		finalRow.push(wards[row[7]]);										// Ward
		finalRow.push(parishes[row[44]]);								// Parish
		finalRow.push(row[11]);													// Quality
		finalRow.push(constituencies[row[17]]);					// Westminster const.
		finalRow.push(european_registers[row[18]]);			// European electoral region
		finalRow.push(regions[row[15]]);								// Region
		finalRow.push(pcts[row[21]]);										// Primary Care Trusts
		finalRow.push(lsoa[row[42]]);										// 2011 LSOA
		finalRow.push(msoa[row[43]]);										// 2011 MSOA
		finalRow.push(nuts[row[22]]);										// NUTS
		finalRow.push(row[2].split(" ")[1]);						// Incode
		finalRow.push(row[2].split(" ")[0]);						// Outcode
		finalRow.push(ccg[lsoa[row[42]]]);							// Clinical Commissioning Group

		return finalRow;
	}

	self._csvSeed(filePath, csvColumns, transform, callback);
}


module.exports = new Postcode();
