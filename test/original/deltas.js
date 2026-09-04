const deltas=proxies.argumentCountChecker({//Idk if it's safe to call this deltas...
	none:null,//Sometimes you might want to use undefined instead, or some Symbol. But it probably shouldn't change more than once per project...
	copied(d)
	{
		console.log()
		console.assert(arguments.length===1, 'deltas.copied error: wrong number of arguments')
		//Copies an object tree
		if(!d||Object.getPrototypeOf(d)!==Object.prototype)
			return d
		const out={}
		for(const [key,val] of Object.entries(d))
			out[key]=deltas.copied(val)
		return out
	},
	apply(o,d,f=(o,d)=>[d,o])
	{
		console.assert(arguments.length>=2,'deltas.apply error: wrong number of arguments')
		//Apply _targetDelta 'd' to object 'o' and make d the receipt.
		//Mutates both o and d and returns nothing.
		assert.isPureObject(d)//All deltas are object trees
		if(o===deltas.none)
			return
		for(const [key,val] of Object.entries(d))
		{
			if(key in o)
			{
				if(val === deltas.none)
				{
					d[key]=o[key]//For our receipt...
					delete o[key]
				}
				else if(Object.getPrototypeOf(val) === Object.prototype && typeof o[key]==='object')//Explanation for "typeof o[key]==='object'" : Because if "typeof x==='object'", then "y in x" probably won't throw an error (this handles the case where we replace a primitive with an object)
				{
					deltas.apply(o[key],val,f)
				}
				else
				{
					[o[key],d[key]] = f(o[key],val)//Added this to enable things like blending etc
				}
			}
			else if(val!==deltas.none)
			{
				o[key] = val
				d[key] = deltas.none
			}
		}
	},
	contains(o,d)
	{
		//Return whether d is in o (also returns true if they're completely equal)
		//This is the most important function for conditions
		console.assert(arguments.length===2, 'deltas.contains error: wrong number of arguments')
		assert.isPureObject(d)//All deltas are object trees
		// let out=true
		// function f(o,d)
		// {
		// 	if(o!==d)
		// 		out=false
		// 	return [o,d]
		// }
		// deltas.apply(o,d,f)//No mutations should occur

		
		let out=true
		function f(o,d)//This is like applyDelta, except it doesn't actually apply anything. Instead, in every place that we would have had to made a change, we instead set out to false
		{
			if(!is_object(o))
				return false
			if(o===deltas.none)
				if(d!==deltas.none)
					out=false
			for(const [key,val] of Object.entries(d))
				if(key in o)
					if(val === deltas.none && key in o)//This means it should have been deleted
						out=false
					else if(Object.getPrototypeOf(val) === Object.prototype && typeof o[key]==='object')//Explanation for "typeof o[key]==='object'" : Because if "typeof x==='object'", then "y in x" probably won't throw an error (this handles the case where we replace a primitive with an object)
						f(o[key],val)
					else if(o[key]!==val)//If a value would have changed
						out=false
					else;//So we don't need brackets
				else if(val!==deltas.none)
					out=false//If a value would have been added
		}
		f(o,d)
		return out
	},
	blended(x,y,alpha,threshold=0)
	{
		console.assert(arguments.length>=3,'deltas.blended error: wrong number of arguments')
		//Pure function: no mutations
		//EXAMPLE:
		//	let a={a:0,b:{c:1,d:2},W:false}
		//	let b={a:1,b:{c:2,d:3},W:true}
		//	deltas.blended(a,b,.2) ===== {a:0.2,b:{c:1.2000000000000002,d:2.2},W:true}
		//Threshold controls when discrete values (such as strings and booleans; basically 
		//	anything that's not a number). When alpha>=threshold, this happens.
		x=deltas.copied(x)
		function blended(o,d)
		{
			if(Object.getPrototypeOf(o)===Number.prototype&&
				Object.getPrototypeOf(d)===Number.prototype  )
				return [blend(o,d,alpha,false),d]
			return [alpha>=threshold?d:o,d]
		}
		deltas.apply(x,y,blended)
		return x
	},
	composed(deltaArray)
	{
		console.assert(arguments.length===1, 'deltas.composed error: wrong number of arguments')
		//Pure function: sums a list of deltas together, essentially creating the equivalent of multiple 
		//If efficiency is an issue, this function might be cached later (somehow we'd have to hash the deltas)
		assert.isPureArray(deltaArray)
		const out={}
		for(const delta of deltaArray)
			deltas.pour(out,delta)
		return out
	},
	soak(o,d)
	{
		console.assert(arguments.length===2, 'deltas.soak error: wrong number of arguments')
		//This just mutates 'd', in the same way a normal deltas.apply would.
		//Returns nothing, just like deltas.apply.
		//The visualization is that we 'soak' the delta shape 'd' in the object 'o', to get a delta that would make something more like 'o'
		//when 'd' is applied to it
		//In other words, the only difference between deltas.soak and deltas.apply is that deltas.soak doesn't mutate 'o'.
		o=deltas.copied(o)
		deltas.apply(o,d)//Don't use a custom version of the 'f' parameter to do swaps; this forgets about setting things to deltas.none etc (this was a mistake I made before in the hopes of better efficiency. It was a mistake and this comment is here so you dont refactor it into the same mistake.)
	},
	pour(o,d)
	{
		console.assert(arguments.length===2, 'deltas.pour error: wrong number of arguments')
		//Opposite of deltas.soak
		//This just mutates 'o', in the same way a normal deltas.apply would.
		//Returns nothing, just like deltas.apply.
		//In other words, the only difference between pour and deltas.apply is that pour doesn't mutate 'd'.
		d=deltas.copied(d)
		deltas.apply(o,d)
	},
	poured(o,d)
	{
		//This should return the resulting object of a deltas.pour action, without mutating either 'o' or 'd'
		console.assert(arguments.length===2, 'deltas.poured error: wrong number of arguments')
		o=deltas.copied(o)
		deltas.pour(o,d)
		return o
		//(Untested)
	},
	soaked(o,d)
	{
		//This should return the resulting object of a deltas.soak action, without mutating either 'o' or 'd'
		console.assert(arguments.length===2, 'deltas.soaked error: wrong number of arguments')
		d=deltas.copied(d)
		deltas.soak(o,d)
		return d
		//(Untested)
	},
	withNoneAs(value,func,...args)
	{
		assert.isFunction(func)
		assert.isPureArray(args)
		//When we don't want to delete null values (for example, when using djson macros)
		const original=deltas.none
		deltas.none=value
		const out=func(...args)
		deltas.none=original
		return out
	},
	withoutDeletions(func,...args)
	{
		//Simply dont ever delete anything...Symbol() is anonymous unless we have seriously messy proxy shenanigans (which I wont ever make) (But the point remains that even that could be avoided if none was passed as a parameter instead, thus confining its scope and making it thread safe)
		return deltas.withNoneAs(Symbol(),func,...args)
	}
})
window.deltas=deltas